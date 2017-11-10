/*
 * noVNC: HTML5 VNC client
 * Copyright 2017 Pierre Ossman for Cendio AB
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

var EventTargetMixin = {
    _listeners: null,

   addEventListener: function(type, callback) {
      if (!this._listeners) {
         this._listeners = new Map();
      }
      if (!this._listeners.has(type)) {
         this._listeners.set(type, new Set());
      }
      this._listeners.get(type).add(callback);
   },

   removeEventListener: function(type, callback) {
      if (!this._listeners || !this._listeners.has(type)) {
         return;
      }
      this._listeners.get(type).delete(callback);
   },

   dispatchEvent: function(event) {
      if (!this._listeners || !this._listeners.has(event.type)) {
         return true;
      }
      this._listeners.get(event.type).forEach(function (callback) {
         callback.call(this, event);
      }, this);
      return !event.defaultPrevented;
   },
};

export default EventTargetMixin;
