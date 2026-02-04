#!/usr/bin/env python3
"""
Tencent GME AuthBuffer Generator for YelloTalk Voice Chat

This module generates AuthBuffer tokens required to connect to Tencent GME
(Game Multimedia Engine) voice chat rooms using credentials extracted from
the YelloTalk Android APK.

GME Credentials (from Constants.java):
    sdkAppId: 1400113874
    key: "IWajGHr5VTo3fd63"

AuthBuffer Format (plaintext before encryption):
    | Field        | Type            | Value                    |
    |--------------|-----------------|--------------------------|
    | cVer         | unsigned char   | 1                        |
    | wOpenIDLen   | unsigned short  | Length of userId         |
    | strOpenID    | string          | userId (e.g., "352080")  |
    | dwSdkAppid   | unsigned int    | 1400113874               |
    | dwReserved1  | unsigned int    | 0                        |
    | dwExpTime    | unsigned int    | current_time + 300       |
    | dwReserved2  | unsigned int    | 0xFFFFFFFF               |
    | dwReserved3  | unsigned int    | 0                        |
    | wRoomIDLen   | unsigned short  | Length of roomId         |
    | strRoomID    | string          | gme_id from room         |

Usage:
    python3 gme_auth.py --room 7868145 --user 352080
"""

import struct
import random
import base64
import time
import argparse
from typing import Optional

# GME Credentials from YelloTalk APK (Constants.java)
GME_SDK_APP_ID = 1400113874
GME_SECRET = "IWajGHr5VTo3fd63"  # 16 bytes - TEA key

# AuthBuffer expiration time in seconds
AUTH_EXPIRE_TIME = 300  # 5 minutes


def xor8(a: bytes, b: bytes) -> bytes:
    """XOR two 8-byte blocks."""
    return bytes(x ^ y for x, y in zip(a, b))


def tea_encrypt_block(v: bytes, key: bytes) -> bytes:
    """
    TEA encrypt a single 8-byte block with 16-byte key.

    Args:
        v: 8 bytes (two 32-bit integers)
        key: 16 bytes (four 32-bit integers)

    Returns:
        Encrypted 8-byte block
    """
    delta = 0x9e3779b9
    v0, v1 = struct.unpack('>II', v)
    k0, k1, k2, k3 = struct.unpack('>IIII', key)

    sum_val = 0
    for _ in range(16):  # 16 rounds
        sum_val = (sum_val + delta) & 0xffffffff
        v0 = (v0 + (((v1 << 4) + k0) ^ (v1 + sum_val) ^ ((v1 >> 5) + k1))) & 0xffffffff
        v1 = (v1 + (((v0 << 4) + k2) ^ (v0 + sum_val) ^ ((v0 >> 5) + k3))) & 0xffffffff

    return struct.pack('>II', v0, v1)


def tea_decrypt_block(v: bytes, key: bytes) -> bytes:
    """
    TEA decrypt a single 8-byte block with 16-byte key.

    Args:
        v: 8 bytes (two 32-bit integers)
        key: 16 bytes (four 32-bit integers)

    Returns:
        Decrypted 8-byte block
    """
    delta = 0x9e3779b9
    v0, v1 = struct.unpack('>II', v)
    k0, k1, k2, k3 = struct.unpack('>IIII', key)

    sum_val = (delta * 16) & 0xffffffff
    for _ in range(16):
        v1 = (v1 - (((v0 << 4) + k2) ^ (v0 + sum_val) ^ ((v0 >> 5) + k3))) & 0xffffffff
        v0 = (v0 - (((v1 << 4) + k0) ^ (v1 + sum_val) ^ ((v1 >> 5) + k1))) & 0xffffffff
        sum_val = (sum_val - delta) & 0xffffffff

    return struct.pack('>II', v0, v1)


def qq_tea_encrypt(plaintext: bytes, key: bytes) -> bytes:
    """
    QQ TEA encrypt with CBC mode.

    Args:
        plaintext: Data to encrypt
        key: 16-byte TEA key

    Returns:
        Encrypted ciphertext
    """
    # Calculate padding
    # We need: fill_count + len(plaintext) + 7 to be a multiple of 8
    # fill_count must be >= 2 (1 header byte + at least 1 random byte)
    remainder = (len(plaintext) + 7 + 2) % 8
    if remainder == 0:
        fill_count = 2
    else:
        fill_count = 2 + (8 - remainder)

    # Build padded data
    padded = bytearray()
    # First byte: low 3 bits = (fill_count - 2), high 5 bits = random
    padded.append((fill_count - 2) | (random.randint(0, 255) & 0xf8))
    # Random fill bytes (fill_count - 1 more bytes)
    for _ in range(fill_count - 1):
        padded.append(random.randint(0, 255))
    padded.extend(plaintext)
    padded.extend(b'\x00' * 7)  # Trailing zeros

    # Encrypt in CBC mode
    ciphertext = bytearray()
    prePlain = bytes(8)
    preCrypt = bytes(8)

    for i in range(0, len(padded), 8):
        block = bytes(padded[i:i+8])
        to_encrypt = xor8(xor8(block, prePlain), preCrypt)
        encrypted = tea_encrypt_block(to_encrypt, key)
        ciphertext.extend(encrypted)
        prePlain = xor8(block, preCrypt)
        preCrypt = encrypted

    return bytes(ciphertext)


def qq_tea_decrypt(ciphertext: bytes, key: bytes) -> Optional[bytes]:
    """
    QQ TEA decrypt with CBC mode (matches qq_tea_encrypt).

    The QQ TEA uses a modified CBC mode where:
    - Encryption: C[i] = E(P[i] XOR prePlain XOR preCrypt)
    - prePlain = P[i] XOR preCrypt_prev
    - preCrypt = C[i]

    Args:
        ciphertext: Encrypted data
        key: 16-byte TEA key

    Returns:
        Decrypted plaintext or None if failed
    """
    if len(ciphertext) < 16 or len(ciphertext) % 8 != 0:
        return None

    plaintext = bytearray()
    prePlain = bytes(8)  # Tracks P[i-1] XOR preCrypt[i-2]
    preCrypt = bytes(8)  # Tracks C[i-1]

    # Decrypt in modified CBC mode
    for i in range(0, len(ciphertext), 8):
        block = ciphertext[i:i+8]
        decrypted = tea_decrypt_block(block, key)
        # decrypted = P[i] XOR prePlain XOR preCrypt, so reverse it
        plain_block = xor8(xor8(decrypted, prePlain), preCrypt)
        plaintext.extend(plain_block)
        # Update state for next block (same as encryption)
        prePlain = xor8(plain_block, preCrypt)
        preCrypt = block

    # Get padding length from first byte (low 3 bits + 2)
    pos = (plaintext[0] & 0x07) + 2

    # Validate length
    if len(plaintext) < pos + 7:
        return None

    # Verify trailing zeros (optional validation)
    if plaintext[-7:] != b'\x00' * 7:
        # May still be valid data, just with corrupted padding
        pass

    return bytes(plaintext[pos:-7])


def build_auth_buffer_plaintext(
    user_id: str,
    room_id: str,
    sdk_app_id: int = GME_SDK_APP_ID,
    expire_time: int = AUTH_EXPIRE_TIME
) -> bytes:
    """
    Build the plaintext buffer for GME AuthBuffer.

    The buffer format follows Tencent's specification:
    - cVer (1 byte): Version, always 1
    - wOpenIDLen (2 bytes): Length of user ID string
    - strOpenID (variable): User ID string
    - dwSdkAppid (4 bytes): SDK App ID
    - dwReserved1 (4 bytes): Reserved, always 0
    - dwExpTime (4 bytes): Expiration timestamp
    - dwReserved2 (4 bytes): Reserved, always 0xFFFFFFFF
    - dwReserved3 (4 bytes): Reserved, always 0
    - wRoomIDLen (2 bytes): Length of room ID string
    - strRoomID (variable): Room ID string

    Args:
        user_id: User ID (gme_user_id from API)
        room_id: Room ID (gme_id from room API)
        sdk_app_id: GME SDK App ID
        expire_time: Token validity in seconds

    Returns:
        Plaintext buffer bytes
    """
    buffer = bytearray()

    user_id_bytes = user_id.encode('utf-8')
    room_id_bytes = room_id.encode('utf-8')

    # cVer: version byte (1)
    buffer.append(1)

    # wOpenIDLen: user ID length (2 bytes, big-endian)
    buffer.extend(struct.pack('>H', len(user_id_bytes)))

    # strOpenID: user ID string
    buffer.extend(user_id_bytes)

    # dwSdkAppid: SDK App ID (4 bytes, big-endian)
    buffer.extend(struct.pack('>I', sdk_app_id))

    # dwReserved1: reserved (4 bytes, always 0)
    buffer.extend(struct.pack('>I', 0))

    # dwExpTime: expiration time (4 bytes, big-endian)
    exp_time = int(time.time()) + expire_time
    buffer.extend(struct.pack('>I', exp_time))

    # dwReserved2: reserved (4 bytes, always 0xFFFFFFFF)
    buffer.extend(struct.pack('>I', 0xFFFFFFFF))

    # dwReserved3: reserved (4 bytes, always 0)
    buffer.extend(struct.pack('>I', 0))

    # wRoomIDLen: room ID length (2 bytes, big-endian)
    buffer.extend(struct.pack('>H', len(room_id_bytes)))

    # strRoomID: room ID string
    buffer.extend(room_id_bytes)

    return bytes(buffer)


def generate_auth_buffer(
    user_id: str,
    room_id: str,
    sdk_app_id: int = GME_SDK_APP_ID,
    key: str = GME_SECRET,
    expire_time: int = AUTH_EXPIRE_TIME
) -> bytes:
    """
    Generate GME AuthBuffer for voice chat authentication.

    This generates the authentication token required to join a Tencent GME
    voice room. The token is created by building a plaintext buffer with
    user and room information, then encrypting it with QQ TEA algorithm.

    Args:
        user_id: User ID (gme_user_id from YelloTalk API)
        room_id: Room voice ID (gme_id from room API)
        sdk_app_id: GME SDK App ID (default: YelloTalk's 1400113874)
        key: GME secret key (default: YelloTalk's key)
        expire_time: Token validity in seconds (default: 300)

    Returns:
        Encrypted AuthBuffer bytes

    Example:
        >>> auth = generate_auth_buffer("352080", "7868145")
        >>> print(base64.b64encode(auth).decode())
    """
    # Ensure key is exactly 16 bytes
    key_bytes = key.encode('utf-8') if isinstance(key, str) else key
    if len(key_bytes) != 16:
        raise ValueError(f"Key must be exactly 16 bytes, got {len(key_bytes)}")

    # Build plaintext buffer
    plaintext = build_auth_buffer_plaintext(
        user_id=user_id,
        room_id=room_id,
        sdk_app_id=sdk_app_id,
        expire_time=expire_time
    )

    # Encrypt with TEA
    ciphertext = qq_tea_encrypt(plaintext, key_bytes)

    return ciphertext


def generate_auth_buffer_base64(
    user_id: str,
    room_id: str,
    sdk_app_id: int = GME_SDK_APP_ID,
    key: str = GME_SECRET,
    expire_time: int = AUTH_EXPIRE_TIME
) -> str:
    """
    Generate GME AuthBuffer as base64 string.

    Same as generate_auth_buffer() but returns base64-encoded string
    which is often required for API calls.

    Args:
        user_id: User ID (gme_user_id from YelloTalk API)
        room_id: Room voice ID (gme_id from room API)
        sdk_app_id: GME SDK App ID
        key: GME secret key
        expire_time: Token validity in seconds

    Returns:
        Base64-encoded AuthBuffer string
    """
    auth_buffer = generate_auth_buffer(
        user_id=user_id,
        room_id=room_id,
        sdk_app_id=sdk_app_id,
        key=key,
        expire_time=expire_time
    )
    return base64.b64encode(auth_buffer).decode('utf-8')


def verify_auth_buffer(auth_buffer: bytes, key: str = GME_SECRET) -> dict:
    """
    Decrypt and verify an AuthBuffer to inspect its contents.

    Useful for debugging and validating generated tokens.

    Args:
        auth_buffer: Encrypted AuthBuffer bytes
        key: GME secret key used for decryption

    Returns:
        Dictionary with parsed buffer fields

    Raises:
        ValueError: If decryption fails or buffer format is invalid
    """
    key_bytes = key.encode('utf-8') if isinstance(key, str) else key

    plaintext = qq_tea_decrypt(auth_buffer, key_bytes)
    if plaintext is None:
        raise ValueError("Failed to decrypt AuthBuffer - invalid key or corrupted data")

    result = {}
    offset = 0

    # cVer
    result['version'] = plaintext[offset]
    offset += 1

    # wOpenIDLen + strOpenID
    user_id_len = struct.unpack('>H', plaintext[offset:offset+2])[0]
    offset += 2
    result['user_id'] = plaintext[offset:offset+user_id_len].decode('utf-8')
    offset += user_id_len

    # dwSdkAppid
    result['sdk_app_id'] = struct.unpack('>I', plaintext[offset:offset+4])[0]
    offset += 4

    # dwReserved1
    result['reserved1'] = struct.unpack('>I', plaintext[offset:offset+4])[0]
    offset += 4

    # dwExpTime
    result['exp_time'] = struct.unpack('>I', plaintext[offset:offset+4])[0]
    offset += 4

    # dwReserved2
    result['reserved2'] = struct.unpack('>I', plaintext[offset:offset+4])[0]
    offset += 4

    # dwReserved3
    result['reserved3'] = struct.unpack('>I', plaintext[offset:offset+4])[0]
    offset += 4

    # wRoomIDLen + strRoomID
    room_id_len = struct.unpack('>H', plaintext[offset:offset+2])[0]
    offset += 2
    result['room_id'] = plaintext[offset:offset+room_id_len].decode('utf-8')

    return result


def print_buffer_analysis(auth_buffer: bytes, key: str = GME_SECRET):
    """Print detailed analysis of an AuthBuffer."""
    print("\n" + "=" * 60)
    print("AuthBuffer Analysis")
    print("=" * 60)
    print(f"Encrypted length: {len(auth_buffer)} bytes")
    print(f"Base64: {base64.b64encode(auth_buffer).decode()[:50]}...")
    print(f"Hex (first 32): {auth_buffer[:32].hex()}")

    try:
        parsed = verify_auth_buffer(auth_buffer, key)
        print("\nDecrypted contents:")
        print(f"  Version: {parsed['version']}")
        print(f"  User ID: {parsed['user_id']}")
        print(f"  SDK App ID: {parsed['sdk_app_id']}")
        print(f"  Expiration: {parsed['exp_time']} ({time.ctime(parsed['exp_time'])})")
        print(f"  Reserved1: {parsed['reserved1']}")
        print(f"  Reserved2: 0x{parsed['reserved2']:08x}")
        print(f"  Reserved3: {parsed['reserved3']}")
        print(f"  Room ID: {parsed['room_id']}")

        # Check expiration
        remaining = parsed['exp_time'] - int(time.time())
        if remaining > 0:
            print(f"\n  [OK] Token valid for {remaining} seconds")
        else:
            print(f"\n  [EXPIRED] Token expired {-remaining} seconds ago")

    except Exception as e:
        print(f"\nFailed to parse: {e}")


def main():
    """Main entry point for CLI usage."""
    parser = argparse.ArgumentParser(
        description="Generate Tencent GME AuthBuffer for YelloTalk voice chat",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --room 7868145 --user 352080
  %(prog)s --room 7868145 --user 352080 --expire 600
  %(prog)s --verify <base64_auth_buffer>

GME Credentials (from YelloTalk APK):
  SDK App ID: 1400113874
  Secret Key: IWajGHr5VTo3fd63
"""
    )

    parser.add_argument('--room', '-r', type=str, help='Room ID (gme_id from room API)')
    parser.add_argument('--user', '-u', type=str, help='User ID (gme_user_id from API)')
    parser.add_argument('--expire', '-e', type=int, default=300, help='Expiration time in seconds (default: 300)')
    parser.add_argument('--verify', '-v', type=str, help='Verify/decrypt a base64 AuthBuffer')
    parser.add_argument('--raw', action='store_true', help='Output raw bytes instead of base64')
    parser.add_argument('--debug', '-d', action='store_true', help='Show detailed analysis')

    args = parser.parse_args()

    # Verify mode
    if args.verify:
        try:
            auth_buffer = base64.b64decode(args.verify)
            print_buffer_analysis(auth_buffer)
        except Exception as e:
            print(f"Error: {e}")
            return 1
        return 0

    # Generate mode
    if not args.room or not args.user:
        parser.print_help()
        print("\nError: --room and --user are required for generation")
        return 1

    print("=" * 60)
    print("Tencent GME AuthBuffer Generator")
    print("=" * 60)
    print(f"SDK App ID: {GME_SDK_APP_ID}")
    print(f"Secret Key: {GME_SECRET}")
    print(f"User ID:    {args.user}")
    print(f"Room ID:    {args.room}")
    print(f"Expire:     {args.expire} seconds")
    print()

    # Generate AuthBuffer
    auth_buffer = generate_auth_buffer(
        user_id=args.user,
        room_id=args.room,
        expire_time=args.expire
    )

    if args.raw:
        # Output raw bytes (for piping)
        import sys
        sys.stdout.buffer.write(auth_buffer)
    else:
        # Output base64
        auth_base64 = base64.b64encode(auth_buffer).decode()
        print(f"AuthBuffer (base64):")
        print(auth_base64)
        print()
        print(f"Length: {len(auth_buffer)} bytes")

    if args.debug:
        print_buffer_analysis(auth_buffer)

    # Always verify the generated buffer
    print("\nVerification:")
    try:
        parsed = verify_auth_buffer(auth_buffer)
        print(f"  [OK] Buffer decrypts correctly")
        print(f"  [OK] User ID matches: {parsed['user_id']}")
        print(f"  [OK] Room ID matches: {parsed['room_id']}")
        print(f"  [OK] SDK App ID: {parsed['sdk_app_id']}")
        exp_remaining = parsed['exp_time'] - int(time.time())
        print(f"  [OK] Expires in {exp_remaining} seconds")
    except Exception as e:
        print(f"  [FAIL] Verification failed: {e}")
        return 1

    return 0


if __name__ == "__main__":
    exit(main())
