// noVNC specific assertions
chai.use(function (_chai, utils) {
    _chai.Assertion.addMethod('displayed', function (target_data) {
        const obj = this._obj;
        const ctx = obj._target.getContext('2d');
        const data_cl = ctx.getImageData(0, 0, obj._target.width, obj._target.height).data;
        // NB(directxman12): PhantomJS 1.x doesn't implement Uint8ClampedArray, so work around that
        const data = new Uint8Array(data_cl);
        const len = data_cl.length;
        new chai.Assertion(len).to.be.equal(target_data.length, "unexpected display size");
        let same = true;
        for (let i = 0; i < len; i++) {
            if (data[i] != target_data[i]) {
                same = false;
                break;
            }
        }
        if (!same) {
            // eslint-disable-next-line no-console
            console.log("expected data: %o, actual data: %o", target_data, data);
        }
        this.assert(same,
                    "expected #{this} to have displayed the image #{exp}, but instead it displayed #{act}",
                    "expected #{this} not to have displayed the image #{act}",
                    target_data,
                    data);
    });

    _chai.Assertion.addMethod('sent', function (target_data) {
        const obj = this._obj;
        obj.inspect = () => {
            const res = { _websocket: obj._websocket, rQi: obj._rQi, _rQ: new Uint8Array(obj._rQ.buffer, 0, obj._rQlen),
                          _sQ: new Uint8Array(obj._sQ.buffer, 0, obj._sQlen) };
            res.prototype = obj;
            return res;
        };
        const data = obj._websocket._get_sent_data();
        let same = true;
        if (data.length != target_data.length) {
            same = false;
        } else {
            for (let i = 0; i < data.length; i++) {
                if (data[i] != target_data[i]) {
                    same = false;
                    break;
                }
            }
        }
        if (!same) {
            // eslint-disable-next-line no-console
            console.log("expected data: %o, actual data: %o", target_data, data);
        }
        this.assert(same,
                    "expected #{this} to have sent the data #{exp}, but it actually sent #{act}",
                    "expected #{this} not to have sent the data #{act}",
                    Array.prototype.slice.call(target_data),
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
