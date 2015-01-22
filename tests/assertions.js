// some useful assertions for noVNC
chai.use(function (_chai, utils) {
    _chai.Assertion.addMethod('displayed', function (target_data) {
        var obj = this._obj;
        var data_cl = obj._drawCtx.getImageData(0, 0, obj._viewportLoc.w, obj._viewportLoc.h).data;
        // NB(directxman12): PhantomJS 1.x doesn't implement Uint8ClampedArray, so work around that
        var data = new Uint8Array(data_cl);
        this.assert(utils.eql(data, target_data),
            "expected #{this} to have displayed the image #{exp}, but instead it displayed #{act}",
            "expected #{this} not to have displayed the image #{act}",
            target_data,
            data);
    });

    _chai.Assertion.addMethod('sent', function (target_data) {
        var obj = this._obj;
        var data = obj._websocket._get_sent_data();
        this.assert(utils.eql(data, target_data),
            "expected #{this} to have sent the data #{exp}, but it actually sent #{act}",
            "expected #{this} not to have sent the data #{act}",
            target_data,
            data);
    });
});
