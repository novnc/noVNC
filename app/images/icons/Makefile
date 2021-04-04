ICONS := \
	368_kasm_logo_only_16x16.png \
	368_kasm_logo_only_24x24.png \
	368_kasm_logo_only_32x32.png \
	368_kasm_logo_only_48x48.png \
	368_kasm_logo_only_64x64.png

ANDROID_LAUNCHER := \
	368_kasm_logo_only_48x48.png \
	368_kasm_logo_only_-72x72.png \
	368_kasm_logo_only_96x96.png \
	368_kasm_logo_only_144x144.png \
	368_kasm_logo_only_192x192.png

IPHONE_LAUNCHER := \
	368_kasm_logo_only_60x60.png \
	368_kasm_logo_only_120x120.png

IPAD_LAUNCHER := \
	368_kasm_logo_only_76x76.png \
	368_kasm_logo_only_152x152.png

ALL_ICONS := $(ICONS) $(ANDROID_LAUNCHER) $(IPHONE_LAUNCHER) $(IPAD_LAUNCHER)

all: $(ALL_ICONS)

368_kasm_logo_only_16x16.png: kasm-icon-sm.svg
	convert -density 90 \
		-background transparent "$<" "$@"
368_kasm_logo_only_24x24.png: kasm-icon-sm.svg
	convert -density 135 \
		-background transparent "$<" "$@"
368_kasm_logo_only_32x32.png: kasm-icon-sm.svg
	convert -density 180 \
		-background transparent "$<" "$@"

368_kasm_logo_only_%.png: kasm-icon.svg
	convert -density $$[`echo $* | cut -d x -f 1` * 90 / 48] \
		-background transparent "$<" "$@"

clean:
	rm -f *.png
