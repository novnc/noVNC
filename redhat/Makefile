
# novnc  doesn't seem to have any clear versioning so we just use the checkout date.
VERSION=20140423
SRCDIR=novnc-${VERSION}

rpm: createspecfile createtarfile rpmbuild

rpmbuild:
	rpmbuild -ta novnc-${VERSION}.tar.gz

createspecfile:
	mkdir -p ${SRCDIR}
	sed 's/%version%/${VERSION}/' novnc.spec.in > ${SRCDIR}/novnc.spec

createtarfile:
	mkdir -p ${SRCDIR}/{utils,redhat}
	cp novnc.init ${SRCDIR}/redhat/novnc.init
	cp ../utils/{websockify,websocket.py,Makefile,launch.sh} ${SRCDIR}/utils
	cp ../{vnc.html,vnc_auto.html,README.md,LICENSE.txt} ${SRCDIR}
	cp -r ../include ${SRCDIR}
	cp -r ../images ${SRCDIR}
	tar zcf novnc-${VERSION}.tar.gz ${SRCDIR}

clean:
	rm -rf ${SRCDIR} novnc-${VERSION}.tar.gz *~