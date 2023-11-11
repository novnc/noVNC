/* jshint expr: true */

const expect = chai.expect;

import * as WebUtil from '../app/webutil.js';

describe('WebUtil', function () {
    "use strict";

    describe('config variables', function () {
        let origState, origHref;
        beforeEach(function () {
            origState = history.state;
            origHref = location.href;
        });
        afterEach(function () {
            history.replaceState(origState, '', origHref);
        });

        it('should parse query string variables', function () {
            // history.pushState() will not cause the browser to attempt loading
            // the URL, this is exactly what we want here for the tests.
            history.replaceState({}, '', "test?myvar=myval");
            expect(WebUtil.getConfigVar("myvar")).to.be.equal("myval");
        });
        it('should return default value when no query match', function () {
            history.replaceState({}, '', "test?myvar=myval");
            expect(WebUtil.getConfigVar("other", "def")).to.be.equal("def");
        });
        it('should handle no query match and no default value', function () {
            history.replaceState({}, '', "test?myvar=myval");
            expect(WebUtil.getConfigVar("other")).to.be.equal(null);
        });
        it('should parse fragment variables', function () {
            history.replaceState({}, '', "test#myvar=myval");
            expect(WebUtil.getConfigVar("myvar")).to.be.equal("myval");
        });
        it('should return default value when no fragment match', function () {
            history.replaceState({}, '', "test#myvar=myval");
            expect(WebUtil.getConfigVar("other", "def")).to.be.equal("def");
        });
        it('should handle no fragment match and no default value', function () {
            history.replaceState({}, '', "test#myvar=myval");
            expect(WebUtil.getConfigVar("other")).to.be.equal(null);
        });
        it('should handle both query and fragment', function () {
            history.replaceState({}, '', "test?myquery=1#myhash=2");
            expect(WebUtil.getConfigVar("myquery")).to.be.equal("1");
            expect(WebUtil.getConfigVar("myhash")).to.be.equal("2");
        });
        it('should prioritize fragment if both provide same var', function () {
            history.replaceState({}, '', "test?myvar=1#myvar=2");
            expect(WebUtil.getConfigVar("myvar")).to.be.equal("2");
        });
    });

    describe('cookies', function () {
        // TODO
    });

    describe('settings', function () {

        describe('localStorage', function () {
            let chrome = window.chrome;
            before(function () {
                chrome = window.chrome;
                window.chrome = null;
            });
            after(function () {
                window.chrome = chrome;
            });

            let origLocalStorage;
            beforeEach(function () {
                origLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");

                Object.defineProperty(window, "localStorage", {value: {}});

                window.localStorage.setItem = sinon.stub();
                window.localStorage.getItem = sinon.stub();
                window.localStorage.removeItem = sinon.stub();

                return WebUtil.initSettings();
            });
            afterEach(function () {
                Object.defineProperty(window, "localStorage", origLocalStorage);
            });

            describe('writeSetting', function () {
                it('should save the setting value to local storage', function () {
                    WebUtil.writeSetting('test', 'value');
                    expect(window.localStorage.setItem).to.have.been.calledWithExactly('test', 'value');
                    expect(WebUtil.readSetting('test')).to.equal('value');
                });

                it('should not crash when local storage save fails', function () {
                    localStorage.setItem.throws(new DOMException());
                    expect(WebUtil.writeSetting('test', 'value')).to.not.throw;
                });
            });

            describe('setSetting', function () {
                it('should update the setting but not save to local storage', function () {
                    WebUtil.setSetting('test', 'value');
                    expect(window.localStorage.setItem).to.not.have.been.called;
                    expect(WebUtil.readSetting('test')).to.equal('value');
                });
            });

            describe('readSetting', function () {
                it('should read the setting value from local storage', function () {
                    localStorage.getItem.returns('value');
                    expect(WebUtil.readSetting('test')).to.equal('value');
                });

                it('should return the default value when not in local storage', function () {
                    expect(WebUtil.readSetting('test', 'default')).to.equal('default');
                });

                it('should return the cached value even if local storage changed', function () {
                    localStorage.getItem.returns('value');
                    expect(WebUtil.readSetting('test')).to.equal('value');
                    localStorage.getItem.returns('something else');
                    expect(WebUtil.readSetting('test')).to.equal('value');
                });

                it('should cache the value even if it is not initially in local storage', function () {
                    expect(WebUtil.readSetting('test')).to.be.null;
                    localStorage.getItem.returns('value');
                    expect(WebUtil.readSetting('test')).to.be.null;
                });

                it('should return the default value always if the first read was not in local storage', function () {
                    expect(WebUtil.readSetting('test', 'default')).to.equal('default');
                    localStorage.getItem.returns('value');
                    expect(WebUtil.readSetting('test', 'another default')).to.equal('another default');
                });

                it('should return the last local written value', function () {
                    localStorage.getItem.returns('value');
                    expect(WebUtil.readSetting('test')).to.equal('value');
                    WebUtil.writeSetting('test', 'something else');
                    expect(WebUtil.readSetting('test')).to.equal('something else');
                });

                it('should not crash when local storage read fails', function () {
                    localStorage.getItem.throws(new DOMException());
                    expect(WebUtil.readSetting('test')).to.not.throw;
                });
            });

            // this doesn't appear to be used anywhere
            describe('eraseSetting', function () {
                it('should remove the setting from local storage', function () {
                    WebUtil.eraseSetting('test');
                    expect(window.localStorage.removeItem).to.have.been.calledWithExactly('test');
                });

                it('should not crash when local storage remove fails', function () {
                    localStorage.removeItem.throws(new DOMException());
                    expect(WebUtil.eraseSetting('test')).to.not.throw;
                });
            });
        });

        describe('chrome.storage', function () {
            let chrome = window.chrome;
            let settings = {};
            before(function () {
                chrome = window.chrome;
                window.chrome = {
                    storage: {
                        sync: {
                            get(cb) { cb(settings); },
                            set() {},
                            remove() {}
                        }
                    }
                };
            });
            after(function () {
                window.chrome = chrome;
            });

            const csSandbox = sinon.createSandbox();

            beforeEach(function () {
                settings = {};
                csSandbox.spy(window.chrome.storage.sync, 'set');
                csSandbox.spy(window.chrome.storage.sync, 'remove');
                return WebUtil.initSettings();
            });
            afterEach(function () {
                csSandbox.restore();
            });

            describe('writeSetting', function () {
                it('should save the setting value to chrome storage', function () {
                    WebUtil.writeSetting('test', 'value');
                    expect(window.chrome.storage.sync.set).to.have.been.calledWithExactly(sinon.match({ test: 'value' }));
                    expect(WebUtil.readSetting('test')).to.equal('value');
                });
            });

            describe('setSetting', function () {
                it('should update the setting but not save to chrome storage', function () {
                    WebUtil.setSetting('test', 'value');
                    expect(window.chrome.storage.sync.set).to.not.have.been.called;
                    expect(WebUtil.readSetting('test')).to.equal('value');
                });
            });

            describe('readSetting', function () {
                it('should read the setting value from chrome storage', function () {
                    settings.test = 'value';
                    expect(WebUtil.readSetting('test')).to.equal('value');
                });

                it('should return the default value when not in chrome storage', function () {
                    expect(WebUtil.readSetting('test', 'default')).to.equal('default');
                });

                it('should return the last local written value', function () {
                    settings.test = 'value';
                    expect(WebUtil.readSetting('test')).to.equal('value');
                    WebUtil.writeSetting('test', 'something else');
                    expect(WebUtil.readSetting('test')).to.equal('something else');
                });
            });

            // this doesn't appear to be used anywhere
            describe('eraseSetting', function () {
                it('should remove the setting from chrome storage', function () {
                    WebUtil.eraseSetting('test');
                    expect(window.chrome.storage.sync.remove).to.have.been.calledWithExactly('test');
                });
            });
        });
    });
});
