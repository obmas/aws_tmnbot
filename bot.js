var Primus = require('primus');
var EventEmitter = require('events').EventEmitter;
var request = require('request');
var util = require('util');
var _ = require('underscore');

module.exports = TMNBot;

function TMNBot(options) {
  this.options = _.extend({
    url: 'http://www.treesmovienight.com',
    pathname: '/socket'
  }, options)
  this.authenticated = false;
  this.ready = false;
  this.connected = false;
  this.callbacks = {};
  this.callbackIndex = 0;
  this.retryCount = 0;
  this.maxRetries = 5;
  this.retryTimeout = 1000;
  this.callQueue = [];
  this.loadSocketOptions(function (options) {
    this.createServer(options);
    this.listen();
    this.connect();
  }.bind(this));
};

util.inherits(TMNBot, EventEmitter);

TMNBot.prototype.loadSocketOptions = function (cb) {
  var url = this.options.url;

  if (url[url.length - 1] !== '/') {
    url += '/';
  }

  if (this.options.pathname[0] === '/') {
    url += this.options.pathname.slice(1);
  } else {
    url += this.options.pathname;
  }

  url += '/spec';

  request({url: url, json:true}, function (err, req, json) {
    if (!err) {
      cb(json);
    } else {
      this.log('Could not fetch socket information.');
    }
  }.bind(this));
};

TMNBot.prototype.log = function () {
  return console.log.apply(console, ['[TMNBot]'].concat(Array.prototype.slice.call(arguments, 0)));
};

TMNBot.prototype.call = function () {
  if (this.authenticated) {
    this._call.apply(this, arguments);
  } else {
    this.callQueue.push(arguments);
  }
};

TMNBot.prototype._call = function () {
  var data = {};
  var _arguments = [];
  for (var i = 0; i < arguments.length; i++) {
    if (i === 0) {
      data.method = arguments[i];
    } else if (i === (arguments.length - 1) && typeof arguments[i] === 'function') {
      data.callback = this.storeCallback(arguments[i]);
    } else {
      _arguments.push(arguments[i]);
    }
  }

  if (_arguments.length) {
    data.arguments = _arguments;
  }

  return this.socket.write(data);
};

TMNBot.prototype.storeCallback = function (cb) {
  var index = this.callbackIndex++;
  this.callbacks['cb_' + index] = cb;
  return 'cb_' + index;
};

TMNBot.prototype.runCallback = function (cb, args) {
  if (this.callbacks[cb] !== 'undefined') {
    this.callbacks[cb].apply(this, args);
  }
};

TMNBot.prototype.createServer = function (options) {
  this.server = Primus.createSocket(options);
};

TMNBot.prototype.listen = function () {
  this.on('ready', this.onReady.bind(this));
};

TMNBot.prototype.connect = function () {
  if (this.socket) {
    this.socket.end();
    this.socket = null;
  }

  this.log('Connecting...',this.options.url);

  this.socket = new this.server(this.options.url);
  this.socket.on('data', this.onData.bind(this));
  this.socket.on('end', this.onClose.bind(this));
};

TMNBot.prototype.onData = function (data) {
  this.log(data);
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
      if (typeof data === 'string') {
        data = JSON.parse(data);
      }
    } catch (e) {}
  }

  if (typeof data === 'object') {
    if (typeof data.callback === 'string') {
      this.runCallback(data.callback, data.arguments);
    } else if (typeof data.channel === 'string' && (data.channel === 'ready' || this.connected)) {
      this.emit(data.channel, data.data);
    }
  }
};

TMNBot.prototype.onClose = function () {
  this.markAsOffline();
};

TMNBot.prototype.onReady = function () {
  this.log('Server is ready...');
  this.ready = true;
  this.sendReady();
};

TMNBot.prototype.sendReady = function () {
  var self = this;
  this.log('Client is ready...');
  this._call('ready', function(err, data) {
    if (!err) {
      self.connected = true;
      self._authenticate();
    } else {
      if (self.retryCount < self.maxRetries) {
        self.retryCount++;
        setTimeout(_.bind(self.sendReady, self), self.retryTimeout);
      } else {
        self.retryCount = 0;
      }
    }
  });
};

TMNBot.prototype._authenticate = function () {
  var self = this;
  this.log('Authenticating...');
  this._call('user.authenticate', { username: this.options.username, password: this.options.password }, function(err, data) {
    if (!err) {
      self.log('Authenticated!');
      self.user = data.user;
      self.authenticated = true;
      self.flushCallQueue();
    } else {
      throw new Error('Could not authenticate the bot.');
    }
  });
};

TMNBot.prototype.flushCallQueue = function () {
  for (var i = 0; i < this.callQueue.length; i++) {
    this._call.apply(this, this.callQueue[i]);
  }
  this.callQueue = [];
};

TMNBot.prototype.disconnect = function () {
  if (this.connected) {
    this.close();
  }
};

TMNBot.prototype.markAsOffline = function () {
  this.user = null;
  this.connected = false;
  this.authenticated = false;
  this.ready = false;
};

TMNBot.prototype.close = function () {
  this.socket.end();
  this.markAsOffline();
  this.server = null;
  this.socket = null;
};

module.exports = TMNBot;
