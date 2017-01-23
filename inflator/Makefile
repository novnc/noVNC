.PHONY: all install clean

all: inflator-merged.js

RJS := r.js

inflator-merged.js: build.js inflator.js pako
	r.js -o build.js

pako: ../node_modules/pako
	$(RJS) -convert $< pako/

install: all
	rm -f ../core/inflator.js
	cp inflator-merged.js ../core/inflator.js

clean:
	rm -f inflator.js
	rm -rf pako
