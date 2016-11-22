all:
.PHONY: update-po update-js update-pot

LINGUAS := de el nl sv

VERSION := $(shell grep '"version"' ../package.json | cut -d '"' -f 4)

POFILES := $(addsuffix .po,$(LINGUAS))
JSFILES := $(addprefix ../app/locale/,$(addsuffix .js,$(LINGUAS)))

update-po: $(POFILES)
update-js: $(JSFILES)

%.po: noVNC.pot
	msgmerge --update --lang=$* $@ $<
../app/locale/%.js: %.po
	./po2js $< $@

update-pot:
	xgettext --output=noVNC.js.pot \
		--copyright-holder="Various Authors" \
		--package-name="noVNC" \
		--package-version="$(VERSION)" \
		--msgid-bugs-address="novnc@googlegroups.com" \
		--add-comments=TRANSLATORS: \
		--sort-by-file \
		../app/*.js \
		../core/*.js \
		../core/input/*.js
	./xgettext-html --output=noVNC.html.pot \
		../vnc.html
	msgcat --output-file=noVNC.pot \
		--sort-by-file noVNC.js.pot noVNC.html.pot
	rm -f noVNC.js.pot noVNC.html.pot
