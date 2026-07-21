set -e
SDK=/root/android-sdk
BT=$SDK/build-tools/30.0.3
PLAT=$SDK/platforms/android-30/android.jar
JB=/usr/lib/jvm/java-17-openjdk-amd64/bin
INSTANCES=${INSTANCES:-5}          # number of independent bot app copies to build
cd /root/gmebuild
rm -rf out && mkdir -p out/classes out/apk/lib/x86_64
echo "== 1. javac =="
$JB/javac -source 8 -target 8 -classpath "$PLAT:gmesdk.jar" -d out/classes $(find src -name '*.java') 2>&1 | grep -v "bootstrap class path" | grep -v "warning:" || true
echo "== 2. d8 -> classes.dex =="
$BT/d8 --min-api 21 --lib "$PLAT" --output out $(find out/classes -name '*.class') gmesdk.jar 2>&1 | tail -3
ls -la out/classes.dex
cp jni/*.so out/apk/lib/x86_64/
cp out/classes.dex out/apk/
[ -f debug.ks ] || $JB/keytool -genkeypair -keystore debug.ks -alias a -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=t" >/dev/null 2>&1

# One compile, N renamed packages (com.gmebot.bot0 .. botN-1). aapt
# --rename-manifest-package makes each a distinct installable app (= independent
# GME client / room), while the activity class stays com.gmebot.test.MainActivity.
# The app derives its HTTP control port (9099+N) from its own package name.
for i in $(seq 0 $((INSTANCES-1))); do
  PKG="com.gmebot.bot$i"
  echo "== instance $i: $PKG =="
  $BT/aapt package -f -M AndroidManifest.xml -I "$PLAT" -F out/base$i.apk --rename-manifest-package "$PKG"
  (cd out/apk && $BT/aapt add ../base$i.apk classes.dex >/dev/null && $BT/aapt add ../base$i.apk lib/x86_64/*.so >/dev/null)
  $BT/zipalign -f 4 out/base$i.apk out/gmebot$i.apk
  $BT/apksigner sign --ks debug.ks --ks-pass pass:android --key-pass pass:android out/gmebot$i.apk
done
echo "== BUILD OK =="; ls -la out/gmebot*.apk
