BROWSER_SIZES := 16 24 32 48 64
ANDROID_SIZES := 72 96 144 192

#IOS_1X_SIZES := 20 29 40 76 # No such devices exist anymore
IOS_2X_SIZES := 40 58 80 120 152 167
IOS_3X_SIZES := 60 87 120 180
ALL_IOS_SIZES := $(IOS_1X_SIZES) $(IOS_2X_SIZES) $(IOS_3X_SIZES)

ALL_SIZES := $(BROWSER_SIZES) $(ANDROID_SIZES) $(ALL_IOS_SIZES)
ALL_ICONS := $(foreach SIZE, $(ALL_SIZES), novnc-$(SIZE)x$(SIZE).png)

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
