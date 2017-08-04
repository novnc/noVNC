ICONS := \
	novnc-16x16.png \
	novnc-24x24.png \
	novnc-32x32.png \
	novnc-48x48.png \
	novnc-64x64.png

ANDROID_LAUNCHER := \
	novnc-48x48.png \
	novnc-72x72.png \
	novnc-96x96.png \
	novnc-144x144.png \
	novnc-192x192.png

IPHONE_LAUNCHER := \
	novnc-60x60.png \
	novnc-120x120.png

IPAD_LAUNCHER := \
	novnc-76x76.png \
	novnc-152x152.png

ALL_ICONS := $(ICONS) $(ANDROID_LAUNCHER) $(IPHONE_LAUNCHER) $(IPAD_LAUNCHER)

all: $(ALL_ICONS)

novnc-16x16.png: novnc-icon-sm.svg
	convert -density 90 \
		-background transparent "$<" "$@"
novnc-24x24.png: novnc-icon-sm.svg
	convert -density 135 \
		-background transparent "$<" "$@"
novnc-32x32.png: novnc-icon-sm.svg
	convert -density 180 \
		-background transparent "$<" "$@"

novnc-%.png: novnc-icon.svg
	convert -density $$[`echo $* | cut -d x -f 1` * 90 / 48] \
		-background transparent "$<" "$@"

clean:
	rm -f *.png
