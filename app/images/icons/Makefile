BROWSER_SIZES := 16 24 32 48 64
ANDROID_SIZES := 72 96 144 192
WEB_ICON_SIZES := $(BROWSER_SIZES) $(ANDROID_SIZES)

#IOS_1X_SIZES := 20 29 40 76 # No such devices exist anymore
IOS_2X_SIZES := 40 58 80 120 152 167
IOS_3X_SIZES := 60 87 120 180
ALL_IOS_SIZES := $(IOS_1X_SIZES) $(IOS_2X_SIZES) $(IOS_3X_SIZES)

ALL_ICONS := \
	$(ALL_IOS_SIZES:%=novnc-ios-%.png) \
	$(WEB_ICON_SIZES:%=novnc-%.png)

all: $(ALL_ICONS)

novnc-16.png: novnc-icon-sm.svg
	convert -density 90 \
		-background transparent "$<" "$@"
novnc-24.png: novnc-icon-sm.svg
	convert -density 135 \
		-background transparent "$<" "$@"
novnc-32.png: novnc-icon-sm.svg
	convert -density 180 \
		-background transparent "$<" "$@"

novnc-%.png: novnc-icon.svg
	convert -density $$[`echo $*` * 90 / 48] \
		-background transparent "$<" "$@"

novnc-ios-%.png: novnc-ios-icon.svg
	convert -depth 8 -background transparent \
		-size $*x$* "$<" "$@"

clean:
	rm -f *.png
