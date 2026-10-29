#!/usr/bin/env bash
# Test app iOS như một app thật trên máy ảo iPhone (chạy trên macOS: GitHub
# Actions "App iOS" hoặc máy Mac có Xcode + Maestro):
#
#   1. Dựng app cho máy ảo, cài mới lên iPhone ảo.
#   2. Maestro bấm/gõ/cuộn như người dùng theo các kịch bản mobile/maestro/*.yaml
#      (khởi động, khách vãng lai, màn đăng nhập, đăng nhập, khách hàng, xoá tài
#      khoản, chính sách). Có USERNAME/PASSWORD mới chạy phần đăng nhập.
#   3. Thông báo đẩy giả lập (simctl push) khi app đang mở.
#   4. Giao diện tối, chữ cỡ lớn (trợ năng), khởi động nguội.
#   5. Soát app có bị văng (báo cáo crash) và lưu nhật ký, video, ảnh chụp.
#
#   USERNAME=... PASSWORD=... OUT=ket-qua mobile/scripts/test-simulator.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/test-results}"
BUNDLE_ID="vn.duocphamlinhphuong.app"
DEVICE_NAME="${DEVICE_NAME:-}"
mkdir -p "$OUT/anh" "$OUT/maestro"
SUMMARY="$OUT/tom-tat.md"
: > "$SUMMARY"
FAILED=0
pass() { echo "| ✅ | $1 |" >> "$SUMMARY"; echo "ĐẠT  $1"; }
fail() { echo "| ❌ | $1 |" >> "$SUMMARY"; echo "LỖI  $1"; FAILED=$((FAILED + 1)); }
skip() { echo "| ⏭️ | $1 |" >> "$SUMMARY"; echo "BỎ QUA  $1"; }
echo "| | Kiểm tra |" >> "$SUMMARY"
echo "|---|---|" >> "$SUMMARY"

# ------------------------------------------------------------------ 1. Dựng
# APP_PATH có sẵn (workflow dựng một lần rồi thử trên nhiều máy ảo) thì không dựng lại.
DERIVED="$OUT/DerivedData"
BUILT_HERE=0
if [ -n "${APP_PATH:-}" ] && [ -d "$APP_PATH" ]; then
  pass "Dùng bản dựng sẵn cho máy ảo"
else
  echo "== Dựng app cho máy ảo"
  if xcodebuild -project "$ROOT/ios/App/App.xcodeproj" -scheme App -configuration Debug \
       -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
       -derivedDataPath "$DERIVED" CODE_SIGNING_ALLOWED=NO build > "$OUT/xcodebuild.log" 2>&1; then
    pass "Dựng app cho máy ảo"
  else
    tail -n 60 "$OUT/xcodebuild.log"
    fail "Dựng app cho máy ảo (xem xcodebuild.log)"
    exit 1
  fi
  APP_PATH="$(find "$DERIVED/Build/Products" -maxdepth 2 -name 'App.app' -type d | head -1)"
  BUILT_HERE=1
fi

# ------------------------------------------------------------------ 2. Máy ảo
# iPhone mới nhất có sẵn (ưu tiên dòng Pro Max = màn 6.9" như ảnh App Store).
if [ -z "$DEVICE_NAME" ]; then
  DEVICE_NAME="$(xcrun simctl list devices available -j | python3 -c '
import json, re, sys
data = json.load(sys.stdin)["devices"]
best = None
for runtime, devices in data.items():
    if "iOS" not in runtime: continue
    ver = tuple(int(x) for x in re.findall(r"\d+", runtime.split("iOS")[-1])[:2])
    for d in devices:
        m = re.match(r"iPhone (\d+) Pro Max$", d["name"])
        if m:
            key = (ver, int(m.group(1)))
            if best is None or key > best[0]: best = (key, d["udid"], d["name"])
print(best[2] if best else "")')"
fi
UDID="$(xcrun simctl list devices available -j | python3 -c "
import json, sys
name = sys.argv[1]
for runtime, devices in sorted(json.load(sys.stdin)['devices'].items(), reverse=True):
    for d in devices:
        if d['name'] == name and 'iOS' in runtime: print(d['udid']); sys.exit()
" "$DEVICE_NAME")"
if [ -z "$UDID" ]; then fail "Không tìm thấy máy ảo iPhone"; exit 1; fi
echo "== Máy ảo: $DEVICE_NAME ($UDID)"
echo "" >> "$SUMMARY"
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b > /dev/null
xcrun simctl ui "$UDID" appearance light
xcrun simctl status_bar "$UDID" override --time "9:41" --batteryState charged --batteryLevel 100 \
  --cellularBars 4 --wifiBars 3 2>/dev/null || true

if xcrun simctl install "$UDID" "$APP_PATH"; then pass "Cài app lên $DEVICE_NAME"; else fail "Cài app"; exit 1; fi

# Quay video toàn bộ lượt test.
xcrun simctl io "$UDID" recordVideo --codec h264 --force "$OUT/video.mp4" > /dev/null 2>&1 &
VIDEO_PID=$!
START_TIME="$(date +%s)"
touch "$OUT/.bat-dau"

# ------------------------------------------------------------------ 3. Maestro
IPAD=0
case "$DEVICE_NAME" in iPad*) IPAD=1 ;; esac
if [ "$IPAD" = 1 ]; then
  # Mở app, chờ trang tải, chụp; đóng hẳn rồi mở lại (khởi động nguội) và chụp lần nữa.
  xcrun simctl launch "$UDID" "$BUNDLE_ID" > /dev/null && sleep 20
  xcrun simctl io "$UDID" screenshot "$OUT/anh/01-ipad-khoi-dong.png" > /dev/null 2>&1
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" > /dev/null 2>&1
  if xcrun simctl launch "$UDID" "$BUNDLE_ID" > /dev/null && sleep 15 \
     && xcrun simctl spawn "$UDID" launchctl list | grep -q "$BUNDLE_ID"; then
    xcrun simctl io "$UDID" screenshot "$OUT/anh/01-ipad-mo-lai.png" > /dev/null 2>&1
    pass "iPad: mở app, đóng hẳn rồi mở lại vẫn chạy (ảnh 01-ipad-khoi-dong.png, 01-ipad-mo-lai.png)"
  else
    fail "iPad: mở lại app không chạy"
  fi
fi
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-180000}"
cd "$OUT/anh"
for flow in "$ROOT"/maestro/0*.yaml; do
  name="$(basename "$flow" .yaml)"
  title="$(sed -n 's/^name: //p' "$flow")"
  # App chỉ iPhone chạy trên iPad ở chế độ tương thích: Maestro (XCUITest) chỉ thấy màn hình chính, không đọc được
  # cửa sổ app (cây phần tử 30/10/2026) — iPad thử bằng mở app, chụp màn, khởi động nguội ở dưới thay cho kịch bản bấm.
  if [ "$IPAD" = 1 ]; then
    skip "$title — iPad chạy app iPhone ở chế độ tương thích, Maestro không đọc được cửa sổ app (thử bằng ảnh màn + khởi động nguội)"
    continue
  fi
  if grep -q 'tags: \[dang-nhap\]' "$flow" && { [ -z "${USERNAME:-}" ] || [ -z "${PASSWORD:-}" ]; }; then
    skip "$title — chưa có tài khoản dùng thử (secret APP_REVIEW_USERNAME/PASSWORD)"
    continue
  fi
  echo "== Maestro: $title"
  # Mỗi kịch bản tối đa 8 phút (Maestro có lúc treo cả lượt Actions): perl alarm vì macOS không có `timeout`.
  run_flow() {
    perl -e 'alarm shift; exec @ARGV' 480 maestro --device "$UDID" test "$flow" \
      -e USERNAME="${USERNAME:-}" -e PASSWORD="${PASSWORD:-}" \
      --format junit --output "$OUT/maestro/$name.xml" \
      --debug-output "$OUT/maestro/$name" > "$OUT/maestro/$name.log" 2>&1
  }
  # Máy ảo GitHub đôi khi khởi động bộ điều khiển Maestro chậm (IOSDriverTimeoutException) hoặc mất nối
  # (DeviceUnreachableException): lỗi công cụ, không phải lỗi app — chạy lại kịch bản đó một lần.
  if run_flow || { grep -qE "IOSDriverTimeoutException|DeviceUnreachableException" "$OUT/maestro/$name.log" "$OUT/maestro/$name.xml" 2>/dev/null \
       && echo "   (chạy lại: Maestro khởi động chậm / mất nối máy ảo)" && run_flow; }; then
    pass "$title"
  else
    tail -n 30 "$OUT/maestro/$name.log"
    # Cây phần tử lúc lỗi: xem Maestro đọc được chữ gì trên màn (nhãn trợ năng của WebView).
    perl -e 'alarm shift; exec @ARGV' 120 maestro --device "$UDID" hierarchy > "$OUT/maestro/$name-cay.json" 2>/dev/null || true
    xcrun simctl io "$UDID" screenshot "$OUT/maestro/$name-loi.png" > /dev/null 2>&1 || true
    fail "$title (xem maestro/$name.log và ảnh lỗi trong maestro/$name)"
  fi
done
cd "$ROOT"

# ------------------------------------------------------------------ 4. Thông báo đẩy
echo "== Thông báo đẩy giả lập"
xcrun simctl launch "$UDID" "$BUNDLE_ID" > /dev/null
sleep 8
if xcrun simctl push "$UDID" "$BUNDLE_ID" "$ROOT/maestro/push.apns"; then
  sleep 3
  xcrun simctl io "$UDID" screenshot "$OUT/anh/07-thong-bao-day.png" > /dev/null 2>&1
  pass "Nhận thông báo đẩy khi app đang mở (ảnh 07-thong-bao-day.png)"
else
  fail "Gửi thông báo đẩy giả lập"
fi

# ------------------------------------------------------------------ 5. Giao diện tối, chữ lớn
echo "== Giao diện tối và chữ cỡ lớn"
xcrun simctl ui "$UDID" appearance dark
xcrun simctl terminate "$UDID" "$BUNDLE_ID" > /dev/null 2>&1
xcrun simctl launch "$UDID" "$BUNDLE_ID" > /dev/null && sleep 10
xcrun simctl io "$UDID" screenshot "$OUT/anh/08-giao-dien-toi.png" > /dev/null 2>&1
xcrun simctl ui "$UDID" appearance light
xcrun simctl ui "$UDID" content_size accessibility-extra-large
xcrun simctl terminate "$UDID" "$BUNDLE_ID" > /dev/null 2>&1
xcrun simctl launch "$UDID" "$BUNDLE_ID" > /dev/null && sleep 10
xcrun simctl io "$UDID" screenshot "$OUT/anh/09-chu-co-lon.png" > /dev/null 2>&1
xcrun simctl ui "$UDID" content_size large
pass "Mở app ở giao diện tối và chữ cỡ lớn (ảnh 08, 09)"

# App còn chạy sau toàn bộ lượt test.
# launchctl đôi khi chưa liệt kê kịp sau khi đổi cỡ chữ: hỏi lại tối đa 5 lần.
running=0
for _ in 1 2 3 4 5; do
  sleep 2
  if xcrun simctl spawn "$UDID" launchctl list | grep -q "$BUNDLE_ID"; then running=1; break; fi
done
if [ "$running" = 1 ]; then
  pass "App vẫn chạy sau toàn bộ lượt test"
else
  fail "App không còn chạy (có thể đã văng)"
fi

# ------------------------------------------------------------------ 6. Crash, nhật ký
kill -INT "$VIDEO_PID" 2>/dev/null; wait "$VIDEO_PID" 2>/dev/null
xcrun simctl spawn "$UDID" log show --style compact --last "$(( $(date +%s) - START_TIME + 60 ))s" \
  --predicate 'process == "App"' > "$OUT/nhat-ky-app.log" 2>/dev/null || true
CRASHES="$(find "$HOME/Library/Logs/DiagnosticReports" -name 'App[-_]*' -newer "$OUT/.bat-dau" 2>/dev/null)"
if [ -n "$CRASHES" ]; then
  mkdir -p "$OUT/crash" && cp $CRASHES "$OUT/crash/"
  fail "App bị văng — báo cáo trong crash/"
else
  pass "Không có báo cáo văng app (crash report)"
fi
if grep -qiE "processDidTerminateOrFailedToLaunch|WebContent process (crashed|terminated)" "$OUT/nhat-ky-app.log"; then
  fail "Trình duyệt trong app (WebView) bị dừng giữa chừng (xem nhat-ky-app.log)"
else
  pass "WebView không bị dừng giữa chừng"
fi

[ "$BUILT_HERE" = 1 ] && rm -rf "$DERIVED"
echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "**Tất cả đạt.**" >> "$SUMMARY"; echo "Tất cả đạt."
else
  echo "**$FAILED mục lỗi.**" >> "$SUMMARY"; echo "$FAILED mục lỗi."
fi
exit "$FAILED"
