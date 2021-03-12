all:
.PHONY: update-po update-js update-pot

LINGUAS := cs de el es ja ko nl pl ru sv tr zh_CN zh_TW

VERSION := $(shell grep '"version"' ../package.json | cut -d '"' -f 4)

POFILES := $(addsuffix .po,$(LINGUAS))
JSONFILES := $(addprefix ../app/locale/,$(addsuffix .json,$(LINGUAS)))

update-po: $(POFILES)
update-js: $(JSONFILES)

%.po: noVNC.pot
	msgmerge --update --lang=$* $@ $<
../app/locale/%.json: %.po
	./po2js $< $@

update-pot:
	xgettext --output=noVNC.js.pot \
		--copyright-holder="The noVNC Authors" \
		--package-name="noVNC" \
		--package-version="$(VERSION)" \
		--msgid-bugs-address="novnc@googlegroups.com" \
		--add-comments=TRANSLATORS: \
		--from-code=UTF-8 \
		--sort-by-file \
		../app/*.js \
		../core/*.js \
		../core/input/*.js
	./xgettext-html --output=noVNC.html.pot \
		../vnc.html
	msgcat --output-file=noVNC.pot \
		--sort-by-file noVNC.js.pot noVNC.html.pot
	rm -f noVNC.js.pot noVNC.html.pot
