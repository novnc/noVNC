import * as chai from '../node_modules/chai/chai.js';
import sinon from '../node_modules/sinon/pkg/sinon-esm.js';
import sinonChai from '../node_modules/sinon-chai/lib/sinon-chai.js';

window.expect = chai.expect;

window.sinon = sinon;
chai.use(sinonChai);

// noVNC specific assertions
chai.use(function (_chai, utils) {
    function _equal(a, b) {
        return a === b;
    }
    _chai.Assertion.addMethod('displayed', function (targetData, cmp=_equal) {
        const obj = this._obj;
        const ctx = obj._target.getContext('2d');
        const data = ctx.getImageData(0, 0, obj._target.width, obj._target.height).data;
        const len = data.length;
        new chai.Assertion(len).to.be.equal(targetData.length, "unexpected display size");
        let same = true;
        for (let i = 0; i < len; i++) {
            if (!cmp(data[i], targetData[i])) {
                same = false;
                break;
            }
        }
        if (!same) {
            // eslint-disable-next-line no-console
            console.log("expected data: %o, actual data: %o", targetData, data);
        }
        this.assert(same,
                    "expected #{this} to have displayed the image #{exp}, but instead it displayed #{act}",
                    "expected #{this} not to have displayed the image #{act}",
                    targetData,
                    data);
    });

    _chai.Assertion.addMethod('sent', function (targetData) {
        const obj = this._obj;
        const data = obj._websocket._getSentData();
        let same = true;
        if (data.length != targetData.length) {
            same = false;
        } else {
            for (let i = 0; i < data.length; i++) {
                if (data[i] != targetData[i]) {
                    same = false;
                    break;
                }
            }
        }
        if (!same) {
            // eslint-disable-next-line no-console
            console.log("expected data: %o, actual data: %o", targetData, data);
        }
        this.assert(same,
                    "expected #{this} to have sent the data #{exp}, but it actually sent #{act}",
                    "expected #{this} not to have sent the data #{act}",
                    Array.prototype.slice.call(targetData),
                    Array.prototype.slice.call(data));
    });

    _chai.Assertion.addProperty('array', function () {
        utils.flag(this, 'array', true);
    });

    _chai.Assertion.overwriteMethod('equal', function (_super) {
        return function assertArrayEqual(target) {
            if (utils.flag(this, 'array')) {
                const obj = this._obj;

                let same = true;

                if (utils.flag(this, 'deep')) {
                    for (let i = 0; i < obj.length; i++) {
                        if (!utils.eql(obj[i], target[i])) {
                            same = false;
                            break;
                        }
                    }

                    this.assert(same,
                                "expected #{this} to have elements deeply equal to #{exp}",
                                "expected #{this} not to have elements deeply equal to #{exp}",
                                Array.prototype.slice.call(target));
                } else {
                    for (let i = 0; i < obj.length; i++) {
                        if (obj[i] != target[i]) {
                            same = false;
                            break;
                        }
                    }

                    this.assert(same,
                                "expected #{this} to have elements equal to #{exp}",
                                "expected #{this} not to have elements equal to #{exp}",
                                Array.prototype.slice.call(target));
                }
            } else {
                _super.apply(this, arguments);
            }
        };
    });
});
