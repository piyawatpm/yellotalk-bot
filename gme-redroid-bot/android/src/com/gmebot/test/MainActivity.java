package com.gmebot.test;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import com.gme.TMG.ITMGContext;
import com.gme.av.sig.AuthBuffer;
import org.json.JSONObject;
import java.io.*;
import java.net.ServerSocket;
import java.net.Socket;

public class MainActivity extends Activity {
  static final String TAG = "GMEBOT";
  static final int APPID = 1400113874;
  static final String KEY = "IWajGHr5VTo3fd63";
  int httpPort = 9099;   // derived per-instance in onCreate (see below)

  ITMGContext ctx; Handler main; PowerManager.WakeLock wake;
  volatile String status="idle", room=null, curFile=null, lastError=null;
  volatile int volume=100;
  volatile boolean inRoom=false, songFinished=false;

  @Override protected void onCreate(Bundle b){
    super.onCreate(b);
    // Each app copy (com.gmebot.botN, produced via aapt --rename-manifest-package)
    // derives a unique control port from the trailing digits of its package name,
    // so N independent GME clients run side by side. Base package -> 9099.
    try{
      java.util.regex.Matcher pkm=java.util.regex.Pattern.compile("(\\d+)$").matcher(getPackageName());
      if(pkm.find()) httpPort=9099+Integer.parseInt(pkm.group(1));
    }catch(Throwable t){ Log.e(TAG,"port",t); }
    PowerManager pm=(PowerManager)getSystemService(Context.POWER_SERVICE);
    wake=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"gmebot:wl"); wake.acquire();
    main=new Handler(Looper.getMainLooper());
    ctx=ITMGContext.GetInstance(getApplicationContext());
    ctx.SetTMGDelegate(new ITMGContext.ITMGDelegate(){
      public void OnEvent(ITMGContext.ITMG_MAIN_EVENT_TYPE type, Intent data){
        int result=data!=null?data.getIntExtra("result",-999):-999;
        if(type==ITMGContext.ITMG_MAIN_EVENT_TYPE.ITMG_MAIN_EVENT_TYPE_ENTER_ROOM){
          Log.i(TAG,"ENTER_ROOM result="+result);
          if(result==0){inRoom=true;status="joined";lastError=null;
            // Do NOT ChangeRoomType(HIGHQUALITY): it forces the music codec on the
            // WHOLE room, thinning out everyone's VOICE (the host becomes inaudible)
            // and — with no noise-suppression — broadcasting our empty capture (Redroid
            // has no mic) as a constant hiss. Stay on the room's default (fluency) codec.
          } else {lastError="enter="+result;status="error";}
        } else if(type==ITMGContext.ITMG_MAIN_EVENT_TYPE.ITMG_MAIN_EVENT_TYPE_EXIT_ROOM){inRoom=false;status="idle";}
        else if(type==ITMGContext.ITMG_MAIN_EVENT_TYPE.ITMG_MAIN_EVENT_TYPE_ACCOMPANY_FINISH){Log.i(TAG,"ACCOMPANY_FINISH");songFinished=true;status="joined";}
      }
    });
    main.post(new Runnable(){public void run(){ if(ctx!=null) ctx.Poll(); main.postDelayed(this,100);} });
    new Thread(new Runnable(){public void run(){ httpServer(); }},"http").start();
    Log.i(TAG,"GmeBot ready pkg="+getPackageName()+" http="+httpPort+" sdk="+ctx.GetSDKVersion());
  }

  interface Op{ void run(); }
  void onMain(final Op op){
    final Object lk=new Object(); final boolean[] d={false};
    main.post(new Runnable(){public void run(){ try{op.run();}catch(Throwable t){Log.e(TAG,"op",t);} synchronized(lk){d[0]=true;lk.notifyAll();} }});
    synchronized(lk){ if(!d[0]){ try{lk.wait(6000);}catch(InterruptedException e){} } }
  }

  void httpServer(){
    try{ ServerSocket ss=new ServerSocket(httpPort);
      while(true){ final Socket s=ss.accept(); new Thread(new Runnable(){public void run(){ handle(s);} }).start(); }
    }catch(Exception e){ Log.e(TAG,"httpsrv",e); }
  }
  void handle(Socket s){
    try{
      BufferedReader in=new BufferedReader(new InputStreamReader(s.getInputStream()));
      String line=in.readLine(); if(line==null){s.close();return;}
      String[] p=line.split(" "); String method=p[0], path=p.length>1?p[1]:"/";
      int clen=0; String h;
      while((h=in.readLine())!=null && !h.isEmpty()){ if(h.toLowerCase().startsWith("content-length:")) clen=Integer.parseInt(h.substring(h.indexOf(':')+1).trim()); }
      char[] body=new char[clen]; int off=0; while(clen>0 && off<clen){ int r=in.read(body,off,clen-off); if(r<0)break; off+=r; }
      JSONObject req=new JSONObject(); try{ if(clen>0) req=new JSONObject(new String(body,0,off)); }catch(Exception e){}
      String resp=route(path,req);
      OutputStream out=s.getOutputStream();
      byte[] rb=resp.getBytes("UTF-8");
      out.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "+rb.length+"\r\nConnection: close\r\n\r\n").getBytes());
      out.write(rb); out.flush(); s.close();
    }catch(Exception e){ try{s.close();}catch(Exception e2){} }
  }
  String route(String path, JSONObject req) throws Exception {
    JSONObject j=new JSONObject();
    if(path.startsWith("/status")){
      j.put("status",status);j.put("inRoom",inRoom);j.put("room",room);j.put("currentFile",curFile);j.put("volume",volume);j.put("songFinished",songFinished);j.put("error",lastError);return j.toString();
    }
    if(path.startsWith("/join")){
      room=req.optString("room",""); final String user=req.optString("user","0"); final String uuid=req.optString("uuid",user);
      status="joining";inRoom=false;lastError=null;
      onMain(new Op(){public void run(){ ctx.Init(String.valueOf(APPID),user); byte[] a=AuthBuffer.getInstance().genAuthBuffer(APPID,room,uuid,KEY); ctx.EnterRoom(room,3,a);} });
      long t0=System.currentTimeMillis(); while(!inRoom && lastError==null && System.currentTimeMillis()-t0<20000){ Thread.sleep(150); }
      j.put("ok",inRoom);j.put("inRoom",inRoom);j.put("status",status);j.put("error",lastError);return j.toString();
    }
    if(path.startsWith("/play")){
      final String file=req.optString("file",""); final boolean loop=req.optBoolean("loop",false);
      curFile=file;songFinished=false;
      final int[] rc={-999};
      onMain(new Op(){public void run(){
        ctx.GetAudioCtrl().EnableAudioCaptureDevice(true); ctx.GetAudioCtrl().EnableAudioSend(true);
        ctx.GetAudioCtrl().SetMicVolume(0); ctx.GetAudioCtrl().EnableSpeaker(false);
        int stopRc=ctx.GetAudioEffectCtrl().StopAccompany(0);
        rc[0]=ctx.GetAudioEffectCtrl().StartAccompany(file,true,loop?-1:1);
        if(rc[0]!=0){ int s2=ctx.GetAudioEffectCtrl().StopAccompany(0); rc[0]=ctx.GetAudioEffectCtrl().StartAccompany(file,true,loop?-1:1); Log.i(TAG,"PLAY-RETRY stop2="+s2+" start2="+rc[0]); }
        ctx.GetAudioEffectCtrl().SetAccompanyVolume(volume);
        Log.i(TAG,"PLAY pkg="+getPackageName()+" room="+room+" file="+file+" stopRc="+stopRc+" startRc="+rc[0]);
      }});
      status="playing"; j.put("ok",rc[0]==0);j.put("startRc",rc[0]);j.put("file",file);return j.toString();
    }
    if(path.startsWith("/stop")){ onMain(new Op(){public void run(){ ctx.GetAudioEffectCtrl().StopAccompany(0);} }); status=inRoom?"joined":"idle";curFile=null; j.put("ok",true);return j.toString(); }
    if(path.startsWith("/pause")){ onMain(new Op(){public void run(){ ctx.GetAudioEffectCtrl().PauseAccompany();} }); status="paused"; j.put("ok",true);return j.toString(); }
    if(path.startsWith("/resume")){ onMain(new Op(){public void run(){ ctx.GetAudioEffectCtrl().ResumeAccompany();} }); status="playing"; j.put("ok",true);return j.toString(); }
    if(path.startsWith("/volume")){ volume=req.optInt("vol",100); onMain(new Op(){public void run(){ ctx.GetAudioEffectCtrl().SetAccompanyVolume(volume);} }); j.put("ok",true);j.put("volume",volume);return j.toString(); }
    if(path.startsWith("/leave")){ onMain(new Op(){public void run(){ try{ctx.GetAudioEffectCtrl().StopAccompany(0);}catch(Throwable t){} ctx.ExitRoom();} }); inRoom=false;status="idle";room=null;curFile=null; j.put("ok",true);return j.toString(); }
    j.put("error","unknown"); return j.toString();
  }
}
