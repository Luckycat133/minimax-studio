(function () {
  'use strict';

  var unsupportedFeatures = [];

  if (typeof Promise === 'undefined') unsupportedFeatures.push('Promise');
  if (typeof fetch === 'undefined') unsupportedFeatures.push('Fetch API');
  if (typeof Symbol === 'undefined') unsupportedFeatures.push('Symbol');
  if (typeof URLSearchParams === 'undefined') unsupportedFeatures.push('URLSearchParams');

  if (unsupportedFeatures.length > 0) {
    var msg = '您的浏览器版本过低，不支持以下特性：' + unsupportedFeatures.join(', ') +
      '。请升级到最新版本的 Chrome、Firefox、Safari 或 Edge。';
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;text-align:center;padding:20px;"><div><h2 style="color:#ef4444;">浏览器不兼容</h2><p style="color:#64748b;max-width:500px;margin:16px auto;">' + msg + '</p></div></div>';
    throw new Error(msg);
  }

  if (!Element.prototype.closest) {
    Element.prototype.closest = function (selector) {
      var el = this;
      while (el && el.nodeType === 1) {
        if (el.matches(selector)) return el;
        el = el.parentElement;
      }
      return null;
    };
  }

  if (!Array.prototype.find) {
    Array.prototype.find = function (predicate) {
      for (var i = 0; i < this.length; i++) {
        if (predicate(this[i], i, this)) return this[i];
      }
      return undefined;
    };
  }

  if (!Array.prototype.includes) {
    Array.prototype.includes = function (searchElement) {
      return this.indexOf(searchElement) !== -1;
    };
  }

  if (!String.prototype.includes) {
    String.prototype.includes = function (search) {
      return this.indexOf(search) !== -1;
    };
  }

  if (!String.prototype.startsWith) {
    String.prototype.startsWith = function (search) {
      return this.indexOf(search) === 0;
    };
  }

  if (!Object.entries) {
    Object.entries = function (obj) {
      var keys = Object.keys(obj);
      var result = [];
      for (var i = 0; i < keys.length; i++) {
        result.push([keys[i], obj[keys[i]]]);
      }
      return result;
    };
  }

  if (!Number.isInteger) {
    Number.isInteger = function (value) {
      return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
    };
  }
})();
