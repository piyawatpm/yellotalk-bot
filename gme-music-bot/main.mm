/**
 * GME Music Bot - Companion service for YelloTalk bot
 * Joins a Tencent GME voice room and plays music via StartAccompany
 *
 * THREADING: GME SDK requires all calls on the main thread.
 * HTTP thread only parses requests and queues commands.
 * Main thread loop processes commands + calls Poll().
 *
 * Controlled via HTTP on port 9876:
 *   POST /join    {"room": "gme_room_id", "user": "numeric_gme_id", "uuid": "real_uuid"}
 *   POST /play    {"file": "path/to/song.mp3", "loop": true}
 *   POST /stop
 *   POST /pause
 *   POST /resume
 *   POST /volume  {"vol": 100}
 *   POST /leave
 *   GET  /status
 */

#import <Foundation/Foundation.h>
#include <GMESDK/tmg_sdk.h>
#include <stdio.h>
#include <string.h>
#include <signal.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <pthread.h>

// YelloTalk GME credentials (from APK reverse engineering)
#define GME_APP_ID    "1400113874"
#define GME_APP_KEY   "IWajGHr5VTo3fd63"
#define HTTP_PORT     9876

// ==================== GLOBAL STATE ====================
static volatile bool g_running = true;
static volatile bool g_initialized = false;
static volatile bool g_inRoom = false;
static volatile bool g_playing = false;
static volatile bool g_songFinished = false;
static volatile bool g_userStopped = false;  // true when user explicitly stops (don't trigger auto-play)
static volatile bool g_audioEnabled = false;
static char g_currentFile[512] = {0};
static char g_roomId[256] = {0};
static char g_userId[256] = {0};   // Numeric gme_user_id (used for Init)
static char g_authId[256] = {0};   // UUID string (used for GenAuthBuffer)
static char g_lastError[512] = {0};
static volatile int g_lastEventType = -1;

// ==================== VOICE ROOM USER TRACKING ====================
#include <vector>
#include <string>
#include <algorithm>

struct VoiceUser {
    std::string openid;
    bool hasAudio;   // currently sending audio (speaking)
};

static std::vector<VoiceUser> g_voiceUsers;
static pthread_mutex_t g_voiceUsersMutex = PTHREAD_MUTEX_INITIALIZER;

// ==================== COMMAND QUEUE ====================
// HTTP thread writes commands here, main thread executes them
enum CmdType { CMD_NONE = 0, CMD_JOIN, CMD_LEAVE, CMD_PLAY, CMD_STOP, CMD_PAUSE, CMD_RESUME, CMD_VOLUME };

struct Command {
    volatile CmdType type;
    char room[256];
    char user[256];    // numeric gme_user_id for Init
    char uuid[256];    // real UUID for GenAuthBuffer
    char file[512];
    bool loop;
    int volume;
    // Result
    volatile bool pending;   // HTTP thread sets true, main thread sets false
    volatile bool done;      // main thread sets true when finished
    volatile bool success;
    char resultMsg[1024];
};

static Command g_cmd = {};
static pthread_mutex_t g_cmdMutex = PTHREAD_MUTEX_INITIALIZER;

// ==================== PARSE USER UPDATE ====================
// GME USER_UPDATE data format: {"event_id":N,"user_list":["openid1","openid2"]}
// event_id: 0=enter, 1=exit, 2=has_audio, 3=no_audio, 4=substream(video), 5=has_accompany_audio
// Any unknown event_id with a user → treat as "user is present"
static void parseUserUpdate(const char* data) {
    // Parse event_id
    const char* eidPtr = strstr(data, "\"event_id\"");
    if (!eidPtr) return;
    eidPtr = strchr(eidPtr, ':');
    if (!eidPtr) return;
    int eventId = atoi(eidPtr + 1);

    // Parse user_list - find the array
    const char* listPtr = strstr(data, "\"user_list\"");
    if (!listPtr) listPtr = strstr(data, "\"openid_list\""); // alternate key
    if (!listPtr) return;
    const char* arrStart = strchr(listPtr, '[');
    const char* arrEnd = arrStart ? strchr(arrStart, ']') : nullptr;
    if (!arrStart || !arrEnd) return;

    // Extract openids from array
    std::vector<std::string> users;
    const char* p = arrStart + 1;
    while (p < arrEnd) {
        const char* qStart = strchr(p, '"');
        if (!qStart || qStart >= arrEnd) break;
        const char* qEnd = strchr(qStart + 1, '"');
        if (!qEnd || qEnd >= arrEnd) break;
        users.push_back(std::string(qStart + 1, qEnd - qStart - 1));
        p = qEnd + 1;
    }

    pthread_mutex_lock(&g_voiceUsersMutex);
    for (const auto& openid : users) {
        // Helper: ensure user exists in list
        auto ensureUser = [&](bool audio) {
            auto it = std::find_if(g_voiceUsers.begin(), g_voiceUsers.end(),
                [&](const VoiceUser& u) { return u.openid == openid; });
            if (it != g_voiceUsers.end()) {
                it->hasAudio = audio;
            } else {
                g_voiceUsers.push_back({openid, audio});
            }
        };

        switch (eventId) {
            case 1: { // EXIT
                g_voiceUsers.erase(
                    std::remove_if(g_voiceUsers.begin(), g_voiceUsers.end(),
                        [&](const VoiceUser& u) { return u.openid == openid; }),
                    g_voiceUsers.end());
                printf("👥 [GME] User EXITED voice: %s (total: %zu)\n", openid.c_str(), g_voiceUsers.size());
                break;
            }
            case 3: { // NO_AUDIO (stopped speaking)
                ensureUser(false);
                printf("🔇 [GME] User SILENT: %s\n", openid.c_str());
                break;
            }
            case 2: { // HAS_AUDIO (speaking)
                ensureUser(true);
                printf("🎙 [GME] User SPEAKING: %s\n", openid.c_str());
                break;
            }
            default: { // 0=enter, 4=substream, 5=accompany, any other = user is present
                ensureUser(eventId == 2 || eventId == 5);
                printf("👥 [GME] User event %d: %s (total: %zu)\n", eventId, openid.c_str(), g_voiceUsers.size());
                break;
            }
        }
    }
    pthread_mutex_unlock(&g_voiceUsersMutex);
    fflush(stdout);
}

// ==================== GME DELEGATE ====================
class GMEDelegate : public ITMGDelegate {
public:
    void OnEvent(ITMG_MAIN_EVENT_TYPE eventType, const char* data) override {
        g_lastEventType = eventType;
        switch (eventType) {
            case ITMG_MAIN_EVENT_TYPE_ENTER_ROOM:
                printf("✅ [GME] Entered room! data=%s\n", data ? data : "null");
                fflush(stdout);
                g_inRoom = true;
                g_lastError[0] = 0;
                // Add self to voice users list
                {
                    pthread_mutex_lock(&g_voiceUsersMutex);
                    std::string selfId(g_userId);
                    auto it = std::find_if(g_voiceUsers.begin(), g_voiceUsers.end(),
                        [&](const VoiceUser& u) { return u.openid == selfId; });
                    if (it == g_voiceUsers.end() && selfId.length() > 0) {
                        g_voiceUsers.push_back({selfId, false});
                        printf("👥 [GME] Self added to voice users: %s\n", selfId.c_str());
                    }
                    pthread_mutex_unlock(&g_voiceUsersMutex);
                }
                enableAudioInternal();
                break;
            case ITMG_MAIN_EVENT_TYPE_EXIT_ROOM:
                printf("🚪 [GME] Exited room\n");
                fflush(stdout);
                g_inRoom = false;
                g_audioEnabled = false;
                pthread_mutex_lock(&g_voiceUsersMutex);
                g_voiceUsers.clear();
                pthread_mutex_unlock(&g_voiceUsersMutex);
                break;
            case ITMG_MAIN_EVENT_TYPE_ROOM_DISCONNECT:
                printf("⚠️  [GME] Room disconnected: %s\n", data ? data : "null");
                fflush(stdout);
                g_inRoom = false;
                g_audioEnabled = false;
                pthread_mutex_lock(&g_voiceUsersMutex);
                g_voiceUsers.clear();
                pthread_mutex_unlock(&g_voiceUsersMutex);
                snprintf(g_lastError, sizeof(g_lastError), "Room disconnected: %s", data ? data : "unknown");
                break;
            case ITMG_MAIN_EVNET_TYPE_USER_UPDATE: {
                printf("👥 [GME] User update: %s\n", data ? data : "null");
                fflush(stdout);
                if (data) {
                    parseUserUpdate(data);
                }
                break;
            }
            case ITMG_MAIN_EVENT_TYPE_ACCOMPANY_FINISH:
                printf("🎵 [GME] Accompaniment finished (userStopped=%d)\n", (int)g_userStopped);
                fflush(stdout);
                g_playing = false;
                if (!g_userStopped) {
                    g_songFinished = true; // Only trigger auto-play for natural endings
                }
                g_userStopped = false;
                break;
            default:
                printf("📡 [GME] Event %d: %s\n", eventType, data ? data : "null");
                fflush(stdout);
                break;
        }
    }

    static void enableAudioInternal() {
        ITMGContext* context = ITMGContextGetInstance();
        if (!context) return;
        ITMGAudioCtrl* audioCtrl = context->GetAudioCtrl();
        if (audioCtrl) {
            // Enable audio pipeline for accompaniment to transmit
            // EnableMic = EnableAudioCaptureDevice + EnableAudioSend
            audioCtrl->EnableAudioCaptureDevice(true);  // Open audio engine (needed for accompaniment uplink)
            audioCtrl->EnableAudioSend(true);            // Enable sending to room
            audioCtrl->SetMicVolume(0);                  // Mute actual mic so Mac ambient sound doesn't leak
            audioCtrl->EnableSpeaker(true);              // Enable receiving + playback

            // Set default accompaniment volume (5 = 50% on portal slider)
            ITMGAudioEffectCtrl* effectCtrl = context->GetAudioEffectCtrl();
            if (effectCtrl) {
                effectCtrl->SetAccompanyVolume(5);
            }

            g_audioEnabled = true;
            printf("🎤 [GME] Audio enabled (mic muted, accompany vol=5)\n");
            fflush(stdout);
        }
    }
};

static GMEDelegate g_delegate;

// ==================== GME OPERATIONS (MAIN THREAD ONLY) ====================

bool initGME(const char* userId) {
    ITMGContext* context = ITMGContextGetInstance();
    if (!context) {
        snprintf(g_lastError, sizeof(g_lastError), "Failed to get GME context");
        return false;
    }

    // If already initialized with same user, skip
    if (g_initialized && strcmp(g_userId, userId) == 0) {
        printf("ℹ️  [GME] Already initialized with user %s, skipping\n", userId);
        fflush(stdout);
        return true;
    }

    // Uninit first if dirty state
    if (g_initialized || g_lastEventType >= 0) {
        printf("🔄 [GME] Uninitializing before re-init...\n");
        fflush(stdout);
        if (g_inRoom) {
            context->ExitRoom();
            for (int i = 0; i < 10; i++) { context->Poll(); usleep(100000); }
        }
        context->Uninit();
        g_initialized = false;
        g_inRoom = false;
        g_audioEnabled = false;
        usleep(200000);
    }

    context->SetTMGDelegate(&g_delegate);
    context->SetLogLevel(TMG_LOG_LEVEL_INFO, TMG_LOG_LEVEL_INFO);

    printf("🔧 [GME] Init(AppID=%s, UserID=%s)...\n", GME_APP_ID, userId);
    fflush(stdout);

    int ret = context->Init(GME_APP_ID, userId);
    if (ret != 0) {
        printf("❌ GME Init failed: %d (userId=%s)\n", ret, userId);
        fflush(stdout);
        snprintf(g_lastError, sizeof(g_lastError), "GME Init failed: %d (userId=%s)", ret, userId);
        context->Uninit();
        return false;
    }

    g_initialized = true;
    strncpy(g_userId, userId, sizeof(g_userId) - 1);
    g_lastError[0] = 0;
    printf("✅ [GME] Initialized (UserID=%s)\n", userId);
    fflush(stdout);
    return true;
}

bool enterRoom(const char* roomId, const char* authUserId) {
    ITMGContext* context = ITMGContextGetInstance();
    if (!context) return false;

    // APK JOINER flow:
    //   Init(appId, numericGmeUserId)
    //   GenAuthBuffer(GME_KEY, gmeRoomId, uuid, GME_SECRET)  ← UUID for auth
    //   EnterRoom(gmeRoomId, FLUENCY, authBuffer)
    const char* authId = (authUserId && strlen(authUserId) > 0) ? authUserId : g_userId;

    unsigned char authBuffer[512] = {0};
    int authLen = QAVSDK_AuthBuffer_GenAuthBuffer(
        1400113874, roomId, authId, GME_APP_KEY, authBuffer, sizeof(authBuffer)
    );

    if (authLen <= 0) {
        snprintf(g_lastError, sizeof(g_lastError), "GenAuthBuffer failed (authLen=%d, authId=%s)", authLen, authId);
        printf("❌ %s\n", g_lastError); fflush(stdout);
        return false;
    }

    printf("🔑 [GME] AuthBuffer: %d bytes, authId=%s\n", authLen, authId);
    printf("🚪 [GME] EnterRoom: room=%s, initUser=%s, authUser=%s, type=HIGHQUALITY\n", roomId, g_userId, authId);
    fflush(stdout);

    // FLUENCY(1)=voice, STANDARD(2)=balanced, HIGHQUALITY(3)=best for music
    int ret = context->EnterRoom(roomId, ITMG_ROOM_TYPE_HIGHQUALITY, (const char*)authBuffer, authLen);
    if (ret != 0) {
        snprintf(g_lastError, sizeof(g_lastError), "EnterRoom returned: %d", ret);
        printf("❌ %s\n", g_lastError); fflush(stdout);
        return false;
    }

    strncpy(g_roomId, roomId, sizeof(g_roomId) - 1);
    strncpy(g_authId, authId, sizeof(g_authId) - 1);
    printf("⏳ [GME] EnterRoom accepted, waiting for callback...\n");
    fflush(stdout);
    return true;
}

bool playMusic(const char* filePath, bool loop) {
    ITMGContext* context = ITMGContextGetInstance();
    if (!context || !g_inRoom) {
        snprintf(g_lastError, sizeof(g_lastError), "Not in room (inRoom=%d, init=%d)", (int)g_inRoom, (int)g_initialized);
        return false;
    }
    if (access(filePath, F_OK) != 0) {
        snprintf(g_lastError, sizeof(g_lastError), "File not found: %s", filePath);
        return false;
    }
    ITMGAudioEffectCtrl* effectCtrl = context->GetAudioEffectCtrl();
    if (!effectCtrl) {
        snprintf(g_lastError, sizeof(g_lastError), "GetAudioEffectCtrl returned null");
        return false;
    }
    int loopCount = loop ? -1 : 1;
    int ret = effectCtrl->StartAccompany(filePath, true, loopCount, 0);
    if (ret != 0) {
        snprintf(g_lastError, sizeof(g_lastError), "StartAccompany returned: %d", ret);
        return false;
    }
    strncpy(g_currentFile, filePath, sizeof(g_currentFile) - 1);
    g_playing = true;
    g_userStopped = false;
    g_lastError[0] = 0;
    printf("🎵 [GME] Playing: %s (loop=%s)\n", filePath, loop ? "yes" : "no");
    fflush(stdout);
    return true;
}

void stopMusic() {
    ITMGContext* context = ITMGContextGetInstance();
    if (!context) return;
    ITMGAudioEffectCtrl* effectCtrl = context->GetAudioEffectCtrl();
    if (effectCtrl) {
        g_userStopped = true; // Don't trigger auto-play on explicit stop
        effectCtrl->StopAccompany(0);
        g_playing = false;
        printf("⏹  [GME] Stopped\n"); fflush(stdout);
    }
}

// ==================== MAIN THREAD: PROCESS COMMANDS ====================

void processCommand(Command* cmd) {
    ITMGContext* ctx = ITMGContextGetInstance();

    switch (cmd->type) {
        case CMD_JOIN: {
            // Step 1: Leave current room if needed
            if (g_inRoom) {
                printf("🔄 [GME] Leaving current room first...\n"); fflush(stdout);
                ctx->ExitRoom();
                for (int i = 0; i < 20 && g_inRoom; i++) { ctx->Poll(); usleep(100000); }
            }

            // Step 2: Init with numeric gme_user_id
            if (!initGME(cmd->user)) {
                cmd->success = false;
                snprintf(cmd->resultMsg, sizeof(cmd->resultMsg),
                    "{\"success\":false,\"error\":\"GME init failed\",\"lastError\":\"%s\"}", g_lastError);
                break;
            }

            // Step 3: Enter room (GenAuthBuffer uses UUID)
            const char* authId = strlen(cmd->uuid) > 0 ? cmd->uuid : cmd->user;
            if (!enterRoom(cmd->room, authId)) {
                cmd->success = false;
                snprintf(cmd->resultMsg, sizeof(cmd->resultMsg),
                    "{\"success\":false,\"error\":\"EnterRoom failed\",\"lastError\":\"%s\"}", g_lastError);
                break;
            }

            // Step 4: Wait for room entry callback (up to 10s, polling on main thread)
            for (int i = 0; i < 100 && !g_inRoom; i++) {
                ctx->Poll();
                usleep(100000);
            }

            if (g_inRoom) {
                printf("✅ [GME] Room entry confirmed! (room=%s, init=%s, auth=%s)\n",
                       cmd->room, cmd->user, authId);
                fflush(stdout);
                cmd->success = true;
                snprintf(cmd->resultMsg, sizeof(cmd->resultMsg),
                    "{\"success\":true,\"inRoom\":true,\"room\":\"%s\",\"user\":\"%s\",\"uuid\":\"%s\",\"audioEnabled\":%s}",
                    cmd->room, cmd->user, cmd->uuid, g_audioEnabled ? "true" : "false");
            } else {
                snprintf(g_lastError, sizeof(g_lastError), "Room entry timeout 10s (init=%s, auth=%s)", cmd->user, authId);
                cmd->success = false;
                snprintf(cmd->resultMsg, sizeof(cmd->resultMsg),
                    "{\"success\":false,\"inRoom\":false,\"error\":\"Room entry timeout\",\"lastError\":\"%s\"}", g_lastError);
            }
            break;
        }

        case CMD_LEAVE: {
            if (g_playing) stopMusic();
            if (ctx && g_inRoom) ctx->ExitRoom();
            g_audioEnabled = false;
            cmd->success = true;
            snprintf(cmd->resultMsg, sizeof(cmd->resultMsg), "{\"success\":true}");
            break;
        }

        case CMD_PLAY: {
            bool ok = playMusic(cmd->file, cmd->loop);
            cmd->success = ok;
            snprintf(cmd->resultMsg, sizeof(cmd->resultMsg),
                "{\"success\":%s,\"file\":\"%s\",\"inRoom\":%s,\"lastError\":\"%s\"}",
                ok ? "true" : "false", cmd->file, g_inRoom ? "true" : "false", g_lastError);
            break;
        }

        case CMD_STOP: {
            stopMusic();
            cmd->success = true;
            snprintf(cmd->resultMsg, sizeof(cmd->resultMsg), "{\"success\":true}");
            break;
        }

        case CMD_PAUSE: {
            if (ctx && ctx->GetAudioEffectCtrl()) ctx->GetAudioEffectCtrl()->PauseAccompany();
            cmd->success = true;
            snprintf(cmd->resultMsg, sizeof(cmd->resultMsg), "{\"success\":true}");
            break;
        }

        case CMD_RESUME: {
            if (ctx && ctx->GetAudioEffectCtrl()) ctx->GetAudioEffectCtrl()->ResumeAccompany();
            cmd->success = true;
            snprintf(cmd->resultMsg, sizeof(cmd->resultMsg), "{\"success\":true}");
            break;
        }

        case CMD_VOLUME: {
            if (ctx && ctx->GetAudioEffectCtrl()) ctx->GetAudioEffectCtrl()->SetAccompanyVolume(cmd->volume);
            cmd->success = true;
            snprintf(cmd->resultMsg, sizeof(cmd->resultMsg), "{\"success\":true,\"vol\":%d}", cmd->volume);
            break;
        }

        default:
            cmd->success = false;
            snprintf(cmd->resultMsg, sizeof(cmd->resultMsg), "{\"error\":\"unknown command\"}");
            break;
    }
}

// ==================== HTTP SERVER (BACKGROUND THREAD) ====================
// Only parses requests and queues commands. Never calls GME SDK directly.

// Helper: submit command and wait for main thread to process it
bool submitCommandAndWait(CmdType type, int timeoutMs = 20000) {
    g_cmd.type = type;
    g_cmd.done = false;
    g_cmd.success = false;
    g_cmd.resultMsg[0] = 0;
    g_cmd.pending = true;  // Signal main thread

    // Wait for main thread to finish processing
    int waited = 0;
    while (!g_cmd.done && waited < timeoutMs) {
        usleep(50000); // 50ms
        waited += 50;
    }

    if (!g_cmd.done) {
        snprintf(g_cmd.resultMsg, sizeof(g_cmd.resultMsg),
            "{\"success\":false,\"error\":\"Command timeout after %dms\"}", timeoutMs);
        g_cmd.pending = false;
        return false;
    }
    return g_cmd.success;
}

void handleHTTPRequest(int clientFd) {
    char buffer[4096] = {0};
    ssize_t bytesRead = read(clientFd, buffer, sizeof(buffer) - 1);
    if (bytesRead <= 0) { close(clientFd); return; }

    char method[16] = {0}, path[256] = {0};
    sscanf(buffer, "%15s %255s", method, path);
    printf("📨 [HTTP] %s %s\n", method, path); fflush(stdout);

    char* body = strstr(buffer, "\r\n\r\n");
    if (body) body += 4;

    char response[8192] = {0};

    // Helper to extract JSON string value
    auto extractStr = [](const char* body, const char* key, char* out, size_t outLen) {
        char searchKey[64];
        snprintf(searchKey, sizeof(searchKey), "\"%s\"", key);
        const char* ptr = strstr(body, searchKey);
        if (!ptr) return;
        ptr = strchr(ptr + strlen(searchKey), '"');
        if (!ptr) return;
        ptr++;
        const char* end = strchr(ptr, '"');
        if (!end) return;
        size_t len = end - ptr;
        if (len >= outLen) len = outLen - 1;
        strncpy(out, ptr, len);
        out[len] = 0;
    };

    if (strcmp(path, "/status") == 0) {
        pthread_mutex_lock(&g_voiceUsersMutex);
        size_t voiceUserCount = g_voiceUsers.size();
        pthread_mutex_unlock(&g_voiceUsersMutex);
        snprintf(response, sizeof(response),
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
            "{\"initialized\":%s,\"inRoom\":%s,\"playing\":%s,\"audioEnabled\":%s,"
            "\"room\":\"%s\",\"user\":\"%s\",\"authId\":\"%s\",\"file\":\"%s\",\"lastError\":\"%s\",\"lastEvent\":%d,\"voiceUsers\":%zu}",
            g_initialized ? "true" : "false",
            g_inRoom ? "true" : "false",
            g_playing ? "true" : "false",
            g_audioEnabled ? "true" : "false",
            g_roomId, g_userId, g_authId, g_currentFile, g_lastError, g_lastEventType, voiceUserCount);
    }
    else if (strcmp(path, "/join") == 0 && body) {
        // Parse: {"room":"xxx","user":"numeric","uuid":"real-uuid"}
        pthread_mutex_lock(&g_cmdMutex);
        memset(&g_cmd, 0, sizeof(g_cmd));
        extractStr(body, "room", g_cmd.room, sizeof(g_cmd.room));
        extractStr(body, "user", g_cmd.user, sizeof(g_cmd.user));
        extractStr(body, "uuid", g_cmd.uuid, sizeof(g_cmd.uuid));

        printf("📋 [GME] /join: room=%s, user=%s (Init), uuid=%s (Auth)\n",
               g_cmd.room, g_cmd.user,
               strlen(g_cmd.uuid) > 0 ? g_cmd.uuid : "(will use user)");
        fflush(stdout);

        if (strlen(g_cmd.room) > 0 && strlen(g_cmd.user) > 0) {
            submitCommandAndWait(CMD_JOIN, 20000);
            int status = g_cmd.success ? 200 : 500;
            snprintf(response, sizeof(response),
                "HTTP/1.1 %d %s\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n\r\n%s",
                status, status == 200 ? "OK" : "Internal Server Error", g_cmd.resultMsg);
        } else {
            snprintf(response, sizeof(response),
                "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
                "{\"error\":\"need room and user. Optional: uuid for auth.\"}");
        }
        pthread_mutex_unlock(&g_cmdMutex);
    }
    else if (strcmp(path, "/play") == 0 && body) {
        pthread_mutex_lock(&g_cmdMutex);
        memset(&g_cmd, 0, sizeof(g_cmd));
        extractStr(body, "file", g_cmd.file, sizeof(g_cmd.file));
        g_cmd.loop = (strstr(body, "\"loop\":false") == NULL); // default true

        if (strlen(g_cmd.file) > 0) {
            submitCommandAndWait(CMD_PLAY, 5000);
            snprintf(response, sizeof(response),
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n\r\n%s",
                g_cmd.resultMsg);
        } else {
            snprintf(response, sizeof(response),
                "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
                "{\"error\":\"need file path\"}");
        }
        pthread_mutex_unlock(&g_cmdMutex);
    }
    else if (strcmp(path, "/stop") == 0) {
        pthread_mutex_lock(&g_cmdMutex);
        memset(&g_cmd, 0, sizeof(g_cmd));
        submitCommandAndWait(CMD_STOP, 5000);
        snprintf(response, sizeof(response),
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n\r\n%s",
            g_cmd.resultMsg);
        pthread_mutex_unlock(&g_cmdMutex);
    }
    else if (strcmp(path, "/pause") == 0) {
        pthread_mutex_lock(&g_cmdMutex);
        memset(&g_cmd, 0, sizeof(g_cmd));
        submitCommandAndWait(CMD_PAUSE, 5000);
        snprintf(response, sizeof(response),
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n\r\n%s",
            g_cmd.resultMsg);
        pthread_mutex_unlock(&g_cmdMutex);
    }
    else if (strcmp(path, "/resume") == 0) {
        pthread_mutex_lock(&g_cmdMutex);
        memset(&g_cmd, 0, sizeof(g_cmd));
        submitCommandAndWait(CMD_RESUME, 5000);
        snprintf(response, sizeof(response),
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n\r\n%s",
            g_cmd.resultMsg);
        pthread_mutex_unlock(&g_cmdMutex);
    }
    else if (strcmp(path, "/volume") == 0 && body) {
        pthread_mutex_lock(&g_cmdMutex);
        memset(&g_cmd, 0, sizeof(g_cmd));
        g_cmd.volume = 100;
        char* volPtr = strstr(body, "\"vol\"");
        if (volPtr) sscanf(volPtr, "\"vol\":%d", &g_cmd.volume);
        submitCommandAndWait(CMD_VOLUME, 5000);
        snprintf(response, sizeof(response),
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n\r\n%s",
            g_cmd.resultMsg);
        pthread_mutex_unlock(&g_cmdMutex);
    }
    else if (strcmp(path, "/leave") == 0) {
        pthread_mutex_lock(&g_cmdMutex);
        memset(&g_cmd, 0, sizeof(g_cmd));
        submitCommandAndWait(CMD_LEAVE, 5000);
        snprintf(response, sizeof(response),
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n\r\n%s",
            g_cmd.resultMsg);
        pthread_mutex_unlock(&g_cmdMutex);
    }
    else if (strcmp(path, "/voice-users") == 0) {
        // Build JSON array of voice room users
        pthread_mutex_lock(&g_voiceUsersMutex);
        std::string json = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
                           "{\"count\":";
        json += std::to_string(g_voiceUsers.size());
        json += ",\"users\":[";
        for (size_t i = 0; i < g_voiceUsers.size(); i++) {
            if (i > 0) json += ",";
            json += "{\"openid\":\"" + g_voiceUsers[i].openid + "\",\"speaking\":" + (g_voiceUsers[i].hasAudio ? "true" : "false") + "}";
        }
        json += "]}";
        pthread_mutex_unlock(&g_voiceUsersMutex);
        // Use json string directly since it may exceed fixed buffer
        write(clientFd, json.c_str(), json.size());
        close(clientFd);
        return;
    }
    else {
        snprintf(response, sizeof(response),
            "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
            "{\"endpoints\":[\"/status\",\"/join\",\"/play\",\"/stop\",\"/pause\",\"/resume\",\"/volume\",\"/leave\",\"/voice-users\"]}");
    }

    write(clientFd, response, strlen(response));
    close(clientFd);
}

void* httpServerThread(void* arg) {
    int serverFd = socket(AF_INET, SOCK_STREAM, 0);
    int opt = 1;
    setsockopt(serverFd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in addr;
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(HTTP_PORT);

    if (bind(serverFd, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        printf("❌ HTTP bind failed on port %d\n", HTTP_PORT); fflush(stdout);
        return NULL;
    }
    listen(serverFd, 5);
    printf("🌐 HTTP server listening on port %d\n", HTTP_PORT); fflush(stdout);

    while (g_running) {
        int clientFd = accept(serverFd, NULL, NULL);
        if (clientFd >= 0) handleHTTPRequest(clientFd);
    }
    close(serverFd);
    return NULL;
}

// ==================== SIGNAL HANDLER ====================

void signalHandler(int sig) {
    printf("\n🛑 Shutting down...\n"); fflush(stdout);
    g_running = false;
    if (g_playing) stopMusic();
    ITMGContext* ctx = ITMGContextGetInstance();
    if (ctx) {
        if (g_inRoom) ctx->ExitRoom();
        ctx->Uninit();
    }
    exit(0);
}

// ==================== MAIN ====================

int main(int argc, char* argv[]) {
    @autoreleasepool {
        signal(SIGINT, signalHandler);
        signal(SIGTERM, signalHandler);

        printf("🎵 GME Music Bot for YelloTalk\n");
        printf("   AppID: %s\n", GME_APP_ID);
        printf("   HTTP Control: http://localhost:%d\n", HTTP_PORT);
        printf("   Threading: GME on main thread, HTTP on background thread\n\n");
        fflush(stdout);

        // Start HTTP server in background thread
        pthread_t httpThread;
        pthread_create(&httpThread, NULL, httpServerThread, NULL);

        // If CLI args provided, auto-join (already on main thread)
        if (argc >= 3) {
            const char* roomId = argv[1];
            const char* userId = argv[2];
            const char* authId = (argc >= 4 && argv[3][0] != '/' && argv[3][0] != '.') ? argv[3] : NULL;
            const char* musicFile = NULL;
            if (argc >= 5) musicFile = argv[4];
            else if (argc >= 4 && !authId) musicFile = argv[3];

            printf("🎵 CLI: room=%s, user=%s, auth=%s, music=%s\n",
                   roomId, userId, authId ? authId : "(=user)", musicFile ? musicFile : "none");
            fflush(stdout);

            if (!initGME(userId)) return 1;
            if (!enterRoom(roomId, authId)) return 1;

            printf("⏳ Waiting for room entry...\n"); fflush(stdout);
            for (int i = 0; i < 100 && !g_inRoom; i++) {
                ITMGContextGetInstance()->Poll();
                usleep(100000);
            }

            if (g_inRoom && musicFile) {
                usleep(500000);
                playMusic(musicFile, true);
            } else if (!g_inRoom) {
                printf("❌ Failed to enter room within 10s\n"); fflush(stdout);
            }
        } else {
            printf("Usage: %s [room_id] [gme_user_id] [uuid] [music.mp3]\n", argv[0]);
            printf("   Or control via HTTP API on port %d\n\n", HTTP_PORT);
            printf("Waiting for HTTP commands...\n"); fflush(stdout);
        }

        // ==================== MAIN LOOP ====================
        // Processes GME Poll() AND queued commands from HTTP thread
        while (g_running) {
            ITMGContext* ctx = ITMGContextGetInstance();
            if (ctx) ctx->Poll();

            // Check for pending command from HTTP thread
            if (g_cmd.pending) {
                g_cmd.pending = false;
                printf("🔄 [Main] Processing command type=%d\n", g_cmd.type); fflush(stdout);
                processCommand(&g_cmd);
                g_cmd.done = true; // Signal HTTP thread that we're done
            }

            // Notify Node.js when a song finishes (async HTTP callback)
            if (g_songFinished) {
                g_songFinished = false;
                NSString *fileStr = [NSString stringWithUTF8String:g_currentFile];
                dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
                    @autoreleasepool {
                        NSURL *url = [NSURL URLWithString:@"http://localhost:5353/api/music/song-ended"];
                        NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
                        request.HTTPMethod = @"POST";
                        [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
                        NSString *body = [NSString stringWithFormat:@"{\"file\":\"%@\"}", fileStr];
                        request.HTTPBody = [body dataUsingEncoding:NSUTF8StringEncoding];
                        NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithRequest:request
                            completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
                                if (error) {
                                    printf("⚠️ [GME] Song-ended callback failed: %s\n", error.localizedDescription.UTF8String);
                                } else {
                                    printf("✅ [GME] Song-ended callback sent\n");
                                }
                                fflush(stdout);
                            }];
                        [task resume];
                    }
                });
            }

            usleep(33000); // ~30fps poll rate
        }
    }
    return 0;
}
