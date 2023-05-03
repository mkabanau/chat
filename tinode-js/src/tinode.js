/**
 * @file SDK to connect to Tinode chat server.
 * See <a href="https://github.com/tinode/webapp">https://github.com/tinode/webapp</a> for real-life usage.
 *
 * @copyright 2015-2022 Tinode LLC.
 * @summary Javascript bindings for Tinode.
 * @license Apache 2.0
 * @version 0.19
 *
 * @example
 * <head>
 * <script src=".../tinode.js"></script>
 * </head>
 *
 * <body>
 *  ...
 * <script>
 *  // Instantiate tinode.new Date()n.
 *  });
 *  tinode.enableLogging(true);
 *  tinode.onDisconnect = (err) => {
 *    // Handle disconnect.
 *  };
 *  // Connect to the server.
 *  tinode.connect('https://example.com/').then(() => {
 *    // Connected. Login now.
 *    return tinode.loginBasic(login, password);
 *  }).then((ctrl) => {
 *    // Logged in fine, attach callbacks, subscribe to 'me'.
 *    const me = tinode.getMeTopic();
 *    me.onMetaDesc = function(meta) { ... };login
 *    me.subscribe({get: {desc: {}, sub: {}}});
 *  }).catch((err) => {
 *    // Login or subscription failed, do something.
 *    ...
 *  });
 *  ...
 * </script>
 * </body>
 */
'use strict';

// NOTE TO DEVELOPERS:
// Localizable strings should be double quoted "строка на другом языке",
// non-localizable strings should be single quoted 'non-localized'.

import AccessMode from './access-mode.js';
import * as Const from './config.js';
import Connection from './connection.js';
import DBCache from './db.js';
import Drafty from './drafty.js';
import LargeFileHelper from './large-file.js';
import {
  Topic,
  TopicMe,
  TopicFnd
} from './topic.js';

import {
  jsonParseHelper,
  mergeObj,
  rfc3339DateString,
  simplify
} from './utils.js';

import * as Y from 'yjs'
import {
  IndexeddbPersistence
} from 'y-indexeddb'

import {
  WebrtcProvider
} from 'y-webrtc'


import {
  v4 as uuidv4
} from 'uuid';


import Hyperswarm from 'hyperswarm'
import goodbye from 'graceful-goodbye'
import random from 'random-access-idb'
import RAM from 'random-access-memory'
// import Hypercore from 'hypercore';
import Corestore from 'corestore'

const datstorage = "tinode-dat-storage"

function IDB(filename) {
  return new RAM()
}

var store = new Corestore(IDB)


let WebSocketProvider;
if (typeof WebSocket != 'undefined') {
  WebSocketProvider = WebSocket;
}

let XHRProvider;
if (typeof XMLHttpRequest != 'undefined') {
  XHRProvider = XMLHttpRequest;
}

let IndexedDBProvider;
if (typeof indexedDB != 'undefined') {
  IndexedDBProvider = indexedDB;
}

// Re-export Drafty.
export {
  Drafty
}

initForNonBrowserApp();

// Utility functions

// Polyfill for non-browser context, e.g. NodeJs.
function initForNonBrowserApp() {
  // Tinode requirement in native mode because react native doesn't provide Base64 method
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

  if (typeof btoa == 'undefined') {
    global.btoa = function(input = '') {
      let str = input;
      let output = '';

      for (let block = 0, charCode, i = 0, map = chars; str.charAt(i | 0) || (map = '=', i % 1); output += map.charAt(63 & block >> 8 - i % 1 * 8)) {

        charCode = str.charCodeAt(i += 3 / 4);

        if (charCode > 0xFF) {
          throw new Error("'btoa' failed: The string to be encoded contains characters outside of the Latin1 range.");
        }
        block = block << 8 | charCode;
      }

      return output;
    };
  }

  if (typeof atob == 'undefined') {
    global.atob = function(input = '') {
      let str = input.replace(/=+$/, '');
      let output = '';

      if (str.length % 4 == 1) {
        throw new Error("'atob' failed: The string to be decoded is not correctly encoded.");
      }
      for (let bc = 0, bs = 0, buffer, i = 0; buffer = str.charAt(i++);

        ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer,
          bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0
      ) {
        buffer = chars.indexOf(buffer);
      }

      return output;
    };
  }

  if (typeof window == 'undefined') {
    global.window = {
      WebSocket: WebSocketProvider,
      XMLHttpRequest: XHRProvider,
      indexedDB: IndexedDBProvider,
      URL: {
        createObjectURL: function() {
          throw new Error("Unable to use URL.createObjectURL in a non-browser application");
        }
      }
    }
  }

  Connection.setNetworkProviders(WebSocketProvider, XHRProvider);
  LargeFileHelper.setNetworkProvider(XHRProvider);
  DBCache.setDatabaseProvider(IndexedDBProvider);
}

// Detect find most useful network transport.
function detectTransport() {
  if (typeof window == 'object') {
    if (window['WebSocket']) {
      return 'ws';
    } else if (window['XMLHttpRequest']) {
      // The browser or node has no websockets, using long polling.
      return 'lp';
    }
  }
  return null;
}

// btoa replacement. Stock btpktoa fails on on non-Latin1 strings.
function b64EncodeUnicode(str) {
  // The encodeURIComponent percent-encodes UTF-8 string,
  // then the percent encoding is converted into raw bytes which
  // can be fed into btoa.
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
    function toSolidBytes(match, p1) {
      return String.fromCharCode('0x' + p1);
    }));
}

// JSON stringify helper - pre-processor for JSON.stringify
function jsonBuildHelper(key, val) {
  if (val instanceof Date) {
    // Convert javascript Date objects to rfc3339 strings
    val = rfc3339DateString(val);
  } else if (val instanceof AccessMode) {
    val = val.jsonHelper();
  } else if (val === undefined || val === null || val === false ||
    (Array.isArray(val) && val.length == 0) ||
    ((typeof val == 'object') && (Object.keys(val).length == 0))) {
    // strip out empty elements while serializing objects to JSON
    return undefined;
  }

  return val;
};

// Trims very long strings (encoded images) to make logged packets more readable.
function jsonLoggerHelper(key, val) {
  if (typeof val == 'string' && val.length > 128) {
    return '<' + val.length + ', bytes: ' + val.substring(0, 12) + '...' + val.substring(val.length - 12) + '>';
  }
  return jsonBuildHelper(key, val);
};

// Parse browser user agent to extract browser name and version.
function getBrowserInfo(ua, product) {
  ua = ua || '';
  let reactnative = '';
  // Check if this is a ReactNative app.
  if (/reactnative/i.test(product)) {
    reactnative = 'ReactNative; ';
  }
  let result;
  // Remove useless string.
  ua = ua.replace(' (KHTML, like Gecko)', '');
  // Test for WebKit-based browser.
  let m = ua.match(/(AppleWebKit\/[.\d]+)/i);
  if (m) {
    // List of common strings, from more useful to less useful.
    // All unknown strings get the highest (-1) priority.
    const priority = ['edg', 'chrome', 'safari', 'mobile', 'version'];
    let tmp = ua.substr(m.index + m[0].length).split(' ');
    let tokens = [];
    let version; // 1.0 in Version/1.0 or undefined;
    // Split string like 'Name/0.0.0' into ['Name', '0.0.0', 3] where the last element is the priority.
    for (let i = 0; i < tmp.length; i++) {
      let m2 = /([\w.]+)[\/]([\.\d]+)/.exec(tmp[i]);
      if (m2) {
        // Unknown values are highest priority (-1).
        tokens.push([m2[1], m2[2], priority.findIndex((e) => {
          return m2[1].toLowerCase().startsWith(e);
        })]);
        if (m2[1] == 'Version') {
          version = m2[2];
        }
      }
    }
    // Sort by priority: more interesting is earlier than less interesting.
    tokens.sort((a, b) => {
      return a[2] - b[2];
    });
    if (tokens.length > 0) {
      // Return the least common browser string and version.
      if (tokens[0][0].toLowerCase().startsWith('edg')) {
        tokens[0][0] = 'Edge';
      } else if (tokens[0][0] == 'OPR') {
        tokens[0][0] = 'Opera';
      } else if (tokens[0][0] == 'Safari' && version) {
        tokens[0][1] = version;
      }
      result = tokens[0][0] + '/' + tokens[0][1];
    } else {
      // Failed to ID the browser. Return the webkit version.
      result = m[1];
    }
  } else if (/firefox/i.test(ua)) {
    m = /Firefox\/([.\d]+)/g.exec(ua);
    if (m) {
      result = 'Firefox/' + m[1];
    } else {
      result = 'Firefox/?';
    }
  } else {
    // Neither AppleWebKit nor Firefox. Try the last resort.
    m = /([\w.]+)\/([.\d]+)/.exec(ua);
    if (m) {
      result = m[1] + '/' + m[2];
    } else {
      m = ua.split(' ');
      result = m[0];
    }
  }

  // Shorten the version to one dot 'a.bb.ccc.d -> a.bb' at most.
  m = result.split('/');
  if (m.length > 1) {
    const v = m[1].split('.');
    const minor = v[1] ? '.' + v[1].substr(0, 2) : '';
    result = `${m[0]}/${v[0]}${minor}`;
  }
  return reactnative + result;
}

/**
 * @class Tinode
 *
 * @param {Object} config - configuration parameters.
 * @param {string} config.appName - Name of the calling application to be reported in the User Agent.
 * @param {string} config.host - Host name and optional port number to connect to.
 * @param {string} config.apiKey - API key generated by <code>keygen</code>.
 * @param {string} config.transport - See {@link Tinode.Connection#transport}.
 * @param {boolean} config.secure - Use Secure WebSocket if <code>true</code>.
 * @param {string} config.platform - Optional platform identifier, one of <code>"ios"</code>, <code>"web"</code>, <code>"android"</code>.
 * @param {boolen} config.persist - Use IndexedDB persistent storage.
 * @param {function} onComplete - callback to call when initialization is completed.
 */
export class Tinode {
  _host;
  _secure;

  _appName;

  // API Key.
  _apiKey;

  // Name and version of the browser.
  _browser = '';
  _platform;
  // Hardware
  _hwos = 'undefined';
  _humanLanguage = 'xx';

  // Logging to console enabled
  _loggingEnabled = false;
  // When logging, trip long strings (base64-encoded images) for readability
  _trimLongStrings = false;
  // UID of the currently authenticated user.
  _myUID = null;
  // Status of connection: authenticated or not.
  _authenticated = false;
  // Login used in the last successful basic authentication
  _login = null;
  // Token which can be used for login instead of login/password.
  _authToken = null;
  // Counter of received packets
  _inPacketCount = 0;
  // Counter for generating unique message IDs
  _messageId = Math.floor((Math.random() * 0xFFFF) + 0xFFFF);
  // Information about the server, if connected
  _serverInfo = null;
  // Push notification token. Called deviceToken for consistency with the Android SDK.
  _deviceToken = null;

  // Cache of pending promises by message id.
  _pendingPromises = {};
  // The Timeout object returned by the reject expired promises setInterval.rfc3339DateString
  _expirePromises = null;

  // Websocket or long polling connection.
  _connection = null;

  // Use indexDB for caching topics and messages.
  _persist = false;
  // IndexedDB wrapper object.
  _db = null;

  // Tinode's cache of objects
  _cache = {};

  // start wallet
  _doc = null
  _w_db_provider = null
  _w_conn_provider = null
  _w_isConnected = false
  _w_user = ""
  swarm = null
  drive = null
  discovery = null
  #init_storage() {
    let core = store.get({
      name: 'my-core-1'
    })
    core.ready().then(()=>{

      core.append(Buffer.from('first start'))

      core.append(Buffer.from('second msg'))
      core.get(0).then((value)=>{
        console.log(value)
      })
      console.log("core length", core.length)
      
     core.info().then((info)=>{
      console.log("core info", info)
     })
    })

    this.swarm = new Hyperswarm()
    goodbye(() => swarm.destroy())
    swarm.on('connection', conn => store.replicate(conn))
    this.drive = new Hyperdrive(store)
    drive.ready().then((value)=>{
      console.log("drive is ready", value)
    })
    
     this.discovery = swarm.join(drive.discoveryKey)
    this.discovery.flushed().then(()=>{
      console.log('drive key:', b4a.toString(drive.key, 'hex'))
    })

    
  }

  #init_wallet() {

    this.logger("init wallet for chat")
    this._doc = new Y.Doc()
    this._w_conn_provider = new WebrtcProvider('webrtc-test-3', this._doc, {
      signaling: ['wss://chat.miapago.tech'],
      maxConns: 70 + Math.floor(Math.random() * 70)
    })
    this._w_conn_provider.on('synced', synced => {
      // NOTE: This is only called when a different browser connects to this client
      // Windows of the same browser communicate directly with each other
      // Although this behavior might be subject to change.
      // It is better not to expect a synced event when using y-webrtc
      console.log('webrtc synced!', synced)
    })
    // this._doc.on('afterTransaction', function(tr, doc){
    //   console.log(JSON.stringify(tr))
    // })
    let inbound = this._doc.getArray("inbound")
    inbound.observe(event => {
      // console.log("observe in", JSON.stringify(event))
    })
    let outbound = this._doc.getArray("outbound")
    outbound.observe(event => {
      // console.log("observe out", JSON.stringify(event))
    })
    let devices = this._doc.getMap('devices')
    let members = this._doc.getMap('members')
    let topics = this._doc.getMap('topics')
    let groups = this._doc.getMap('groups')

    let tags = this._doc.getMap("tags")
    let personal = this._doc.getMap("personal")

    this._w_db_provider = new IndexeddbPersistence("chat-3", this._doc)
    this._w_db_provider.on('synced', () => {
      console.log('content from the database is loaded')
      this.#connectionOpen();
      this._w_isConnected = true
    })
    // setTimeout(()=>{
    //   console.log("outbound",outbound.toJSON())
    //   console.log("inbound",inbound.toJSON())
    // }, 30000)
  }

  #w_send(pkt, id) {

    pkt = simplify(pkt);
    let outbound = this._doc.getArray("outbound")
    outbound.push([pkt])

    let promise;
    if (id) {
      promise = this.#makePromise(id);
    }
    pkt = simplify(pkt);
    let msg = JSON.stringify(pkt);
    this.logger("out: " + (this._trimLongStrings ? JSON.stringify(pkt, jsonLoggerHelper) : msg));
    // try {
    //   this._connection.sendText(msg);
    // } catch (err) {
    //   // If sendText throws, wrap the error in a promise or rethrow.
    //   if (id) {
    //     this.#execPromise(id, Connection.NETWORK_ERROR, null, err.message);
    //   } else {
    //     throw err;
    //   }
    // }
    this.#w_processor(pkt)

    return promise;
  }

  #w_onMessage(data) {

    let inbound = this._doc.getArray("inbound")
    let pkt = JSON.parse(data, jsonParseHelper);
    pkt = simplify(pkt);
    inbound.push([pkt])
  }

  #w_topicme(pkt) {
    let members = this._doc.getMap("members")
    let usr = members.get(this._w_user)

    let subs = []
    // subs.push(
    //   { "updated": "2023-01-14T21:26:11.482Z", "acs": { "mode": "JRWPASDO", "given": "JRWPASDO", "want": "JRWPASDO" }, "read": 1, "recv": 1, "public": { "fn": "general", "note": "␡" }, "private": { "comment": "est" }, "topic": "grpVQB3D-WI4TY", "touched": "2023-01-14T21:27:47.345Z", "seq": 1 })
    let groups = this._doc.getMap("groups")
    if (groups.size > 0) {
      for (const [key, value] of groups) {
        let groupMeta = Object.assign({
          "read": 1,
          "recv": 1,
          "seq": 1
        }, value.desc)
        subs.push(groupMeta)
      }
    }

    let personalVault = this._doc.getMap("personal")
    let personalSubs = personalVault.get(this._w_user)
    for (const [key, value] of personalSubs) {
      let usrDesc = members.get(key)
      subs.push({
        "updated": rfc3339DateString(new Date()), //rework
        "acs": {
          "mode": "JRWPA",
          "given": "JRWPA",
          "want": "JRWPA"
        },
        "read": 1,
        "recv": 1,
        "public": usrDesc.desc.public,
        "topic": key,
        "touched": rfc3339DateString(new Date()),
        "seq": 1,
        "seen": {
          "when": rfc3339DateString(new Date()),
          "ua": "TinodeWeb/0.19.3 (Chrome/102.0; Linux x86_64); tinodejs/0.19.3"
        }
      })
    }

    return [{
        "ctrl": {
          "id": pkt.sub.id,
          "topic": pkt.sub.topic,
          "code": 200,
          "text": "ok",
          "ts": rfc3339DateString(new Date())
        }
      },
      {
        "meta": {
          "id": pkt.sub.id,
          "topic": pkt.sub.topic,
          "ts": rfc3339DateString(new Date()),
          "desc": {
            "created": usr.desc.created,
            "updated": usr.desc.updated,
            "touched": usr.desc.created,
            "defacs": {
              "auth": "JRWPAS",
              "anon": "N"
            },
            "acs": {
              "mode": "JPS",
              "given": "JPS",
              "want": "JPS"
            },
            "public": usr.desc.public
          }
        }
      },
      {
        "meta": {
          "id": pkt.sub.id,
          "topic": pkt.sub.topic,
          "ts": rfc3339DateString(new Date()),
          "sub": subs
        }
      },
      {
        "meta": {
          "id": pkt.sub.id,
          "topic": pkt.sub.topic,
          "ts": rfc3339DateString(new Date()),
          "tags": ["basic:" + "testName"]
        }
      },
      {
        "ctrl": {
          "id": pkt.sub.id,
          "topic": pkt.sub.topic,
          "ts": rfc3339DateString(new Date()),
          "params": {
            "what": "creds"
          },
          "code": 204,
          "text": "no content"
        }
      }
    ]
  }

  #w_topic_usr(pkt) {
    let personalVault = this._doc.getMap("personal")
    let personal = personalVault.get(this._w_user)

    let p2pchatmeta = personal.get(pkt.sub.topic)
    let p2pchat = this._doc.getArray(p2pchatmeta.chatId)
    // let groupMeta = Object.assign({
    //   "read": 1,
    //   "recv": 1,
    //   "seq": 1
    // }, group.desc)
    let msgs = []

    msgs.push({
      "ctrl": {
        "id": pkt.sub.id,
        "topic": pkt.sub.topic,
        "code": 200,
        "text": "ok",
        "ts": rfc3339DateString(new Date())
      }
    })

    msgs.push({
      "meta": {
        "id": pkt.sub.id,
        "topic": pkt.sub.topic,
        "ts": rfc3339DateString(new Date()),
        "desc": {
          "updated": "2023-01-18T11:19:13.326Z",
          "touched": "2023-01-18T11:19:13.337Z",
          "acs": {
            "mode": "JRWPA",
            "given": "JRWPA",
            "want": "JRWPA"
          },
          "seq": 1
        }
      }
    })
    msgs.push({
      "pres": {
        "topic": "me",
        "src": pkt.sub.topic,
        "what": "on"
      }
    })

    let subs = []

    subs.push({
      "updated": rfc3339DateString(new Date()),
      "acs": {
        "mode": "JRWPA",
        "given": "JRWPA",
        "want": "JRWPA"
      },
      "user": this._w_user
    })
    subs.push({
      "updated": rfc3339DateString(new Date()),
      "acs": {
        "mode": "JRWPA",
        "given": "JRWPAS",
        "want": "JRWPA"
      },
      "read": 1,
      "recv": 1,
      "user": pkt.sub.topic
    })

    //rework
    msgs.push({
      "meta": {
        "id": pkt.sub.id,
        "topic": pkt.sub.topic,
        "ts": rfc3339DateString(new Date()),
        "sub": subs
      }
    })

    p2pchat.observe((event, tr) => {
      {
        event.target === p2pchat
        console.log(JSON.stringify(event.changes.delta))
        let newMessage = event.changes.delta[0].insert[0]
        newMessage.data.topic = pkt.sub.topic
        if (newMessage.from != this._w_user) {
          let pkt2 = simplify(newMessage);
          let msg2 = JSON.stringify(pkt2);
          this.#dispatchMessage(msg2)
        }
        // let newMessage =  {"data":{"topic":pkt.sub.topic,"from":"usrFqAz3xAXbJ0","ts":"2023-01-18T10:28:49.243Z","seq":8,"content":"1"}} 

      }
    })
    for (const msg of p2pchat) {
      msg.data.topic = pkt.sub.topic
      msgs.push(
        msg
      )
    }

    msgs.push({
      "ctrl": {
        "id": pkt.sub.id,
        "topic": pkt.sub.topic,
        "params": {
          "count": p2pchat.length,
          "what": "data"
        },
        "code": 208,
        "text": "delivered",
        "ts": rfc3339DateString(new Date())
      }
    })
    return msgs
  }

  #w_topic_grp(pkt) {

    let groups = this._doc.getMap("groups")
    let group = groups.get(pkt.sub.topic)
    let groupMeta = Object.assign({
      "read": 1,
      "recv": 1,
      "seq": 1
    }, group.desc)
    let msgs = []

    msgs.push({
      "ctrl": {
        "id": pkt.sub.id,
        "topic": pkt.sub.topic,
        "code": 200,
        "text": "ok",
        "ts": rfc3339DateString(new Date())
      }
    })

    msgs.push({
      "meta": {
        "id": pkt.sub.id,
        "topic": pkt.sub.topic,
        "ts": rfc3339DateString(new Date()),
        "desc": groupMeta
      }
    })
    msgs.push({
      "pres": {
        "topic": "me",
        "src": pkt.sub.topic,
        "what": "on"
      }
    })

    let subs = []
    // subs.push(
    //   { "updated": "2023-01-16T16:25:44.340Z", "online": true, "acs": { "mode": "JRWPASDO", "given": "JRWPASDO", "want": "JRWPASDO" }, "read": 1, "recv": 1, "public": { "fn": "maksim2" }, "private": { "comment": "testt" }, "user": "usrFqAz3xAXbJ0" }
    // )
    // subs.push(
    //   { "updated": "2023-01-16T15:35:19.089Z", "acs": { "mode": "JRWPS", "given": "JRWPS", "want": "JRWPS" }, "read": 1, "recv": 1, "public": { "fn": "we" }, "user": "usrI9KrInUCvMs" }
    // )
    let members = this._doc.getMap("members")
    for (const [key, value] of members) {
      subs.push({
        "updated": value.desc.updated,
        "acs": {
          "mode": "JRWPS",
          "given": "JRWPS",
          "want": "JRWPS"
        },
        "read": 1,
        "recv": 1,
        "public": value.desc.public,
        "user": key
      })
    }

    //rework
    msgs.push({
      "meta": {
        "id": pkt.sub.id,
        "topic": pkt.sub.topic,
        "ts": rfc3339DateString(new Date()),
        "sub": subs
      }
    })

    let groupMessages = this._doc.getArray(pkt.sub.topic)
    groupMessages.observe((event, tr) => {
      {
        event.target === groupMessages
        console.log(JSON.stringify(event.changes.delta))
        let newMessage = event.changes.delta[0].insert[0]
        if (newMessage.from != this._w_user) {
          let pkt2 = simplify(newMessage);
          let msg2 = JSON.stringify(pkt2);
          this.#dispatchMessage(msg2)
        }
        // let newMessage =  {"data":{"topic":pkt.sub.topic,"from":"usrFqAz3xAXbJ0","ts":"2023-01-18T10:28:49.243Z","seq":8,"content":"1"}} 

      }
    })
    for (const msg of groupMessages) {
      msgs.push(
        msg
      )
    }
    msgs.push({
      "ctrl": {
        "id": pkt.sub.id,
        "topic": pkt.sub.topic,
        "params": {
          "count": 6,
          "what": "data"
        },
        "code": 208,
        "text": "delivered",
        "ts": rfc3339DateString(new Date())
      }
    })
    return msgs

    // return [
    //   {
    //     "ctrl": {
    //       "id": pkt.sub.id,
    //       "topic": pkt.sub.topic,
    //       "code": 200, "text": "ok", "ts": rfc3339DateString(new Date())
    //     }
    //   },
    //   {
    //     "meta": {
    //       "id": pkt.sub.id,
    //       "topic": pkt.sub.topic,
    //       "ts": rfc3339DateString(new Date()),
    //       "desc": { "updated": "2023-01-15T15:03:24.157Z", "touched": "2023-01-16T16:54:08.968Z", "online": true, "defacs": { "auth": "JRWPS", "anon": "N" }, "acs": { "mode": "JRWPASDO", "given": "JRWPASDO", "want": "JRWPASDO" }, "seq": 6, "read": 6, "recv": 6 }
    //     }
    //   },
    //   { "pres": { "topic": "me", "src": pkt.sub.topic, "what": "on" } },
    //   {
    //     "meta": {
    //       "id": pkt.sub.id,
    //       "topic": pkt.sub.topic,
    //       "ts": rfc3339DateString(new Date()),
    //       "sub": [{ "updated": "2023-01-16T16:25:44.340Z", "online": true, "acs": { "mode": "JRWPASDO", "given": "JRWPASDO", "want": "JRWPASDO" }, "read": 6, "recv": 6, "public": { "fn": "maksim2" }, "private": { "comment": "testt" }, "user": "usrFqAz3xAXbJ0" }, { "updated": "2023-01-16T15:35:19.089Z", "acs": { "mode": "JRWPS", "given": "JRWPS", "want": "JRWPS" }, "read": 5, "recv": 5, "public": { "fn": "we" }, "user": "usrI9KrInUCvMs" }]
    //     }
    //   },
    //   { "data": { "topic": pkt.sub.topic, "from": "usrFqAz3xAXbJ0", "ts": "2023-01-16T16:54:08.968Z", "seq": 6, "content": "send" } },
    //   { "data": { "topic": pkt.sub.topic, "from": "usrI9KrInUCvMs", "ts": "2023-01-16T16:04:34.737Z", "seq": 5, "content": "l" } },
    //   { "data": { "topic": pkt.sub.topic, "from": "usrI9KrInUCvMs", "ts": "2023-01-16T16:04:22.881Z", "seq": 4, "content": "test" } },
    //   { "data": { "topic": pkt.sub.topic, "from": "usrI9KrInUCvMs", "ts": "2023-01-16T16:04:19.600Z", "seq": 3, "content": "twat" } },
    //   { "data": { "topic": pkt.sub.topic, "from": "usrFqAz3xAXbJ0", "ts": "2023-01-16T09:12:52.392Z", "seq": 2, "content": "test me" } },
    //   { "data": { "topic": pkt.sub.topic, "from": "usrFqAz3xAXbJ0", "ts": "2023-01-16T09:12:47.820Z", "seq": 1, "content": "12345" } },
    //   {
    //     "ctrl": {
    //       "id": pkt.sub.id,
    //       "topic": pkt.sub.topic,
    //       "params": { "count": 6, "what": "data" }, "code": 208, "text": "delivered", "ts": rfc3339DateString(new Date())
    //     }
    //   }
    // ]
  }
  #w_create_grp(pkt) {
    let tmptopic = pkt.sub.topic
    let groups = this._doc.getMap("groups")
    pkt.sub.topic = "grp" + uuidv4()
    groups.set(pkt.sub.topic, {
      "desc": {
        "topic": pkt.sub.topic,
        "updated": "2023-01-17T19:13:47.213Z",
        "touched": "2023-01-17T19:26:38.554Z",
        "online": true,
        "defacs": {
          "auth": "JRWPS",
          "anon": "N"
        },
        "acs": {
          "mode": "JRWPASDO",
          "given": "JRWPASDO",
          "want": "JRWPASDO"
        },
        "public": pkt.sub.set.desc.public,
        "private": pkt.sub.set.desc.private
      }
    })
    let groupMessages = this._doc.getArray(pkt.sub.topic)
    groupMessages.observe((event, tr) => {
      {
        event.target === groupMessages
        console.log(JSON.stringify(event.changes.delta))
        let newMessage = event.changes.delta[0].insert[0]
        if (newMessage.from != this._w_user) {
          let pkt2 = simplify(newMessage);
          let msg2 = JSON.stringify(pkt2);
          this.#dispatchMessage(msg2)
        }
        // let newMessage =  {"data":{"topic":pkt.sub.topic,"from":"usrFqAz3xAXbJ0","ts":"2023-01-18T10:28:49.243Z","seq":8,"content":"1"}} 

      }
    })
    let timestamp = rfc3339DateString(new Date())
    let msgs = []
    msgs.push({
      "ctrl": {
        "id": pkt.sub.id,
        "topic": pkt.sub.topic,
        "params": {
          "acs": {
            "mode": "JRWPASDO",
            "given": "JRWPASDO",
            "want": "JRWPASDO"
          },
          "tmpname": tmptopic
        },
        "code": 200,
        "text": "ok",
        "ts": timestamp
      }
    })

    msgs.push({
      "meta": {
        "id": pkt.sub.id,
        "topic": pkt.sub.topic,
        "ts": timestamp,
        "desc": {
          "created": timestamp,
          "updated": timestamp,
          "touched": timestamp,
          "online": true,
          "defacs": {
            "auth": "JRWPS",
            "anon": "N"
          },
          "acs": {
            "mode": "JRWPASDO",
            "given": "JRWPASDO",
            "want": "JRWPASDO"
          },
          "public": pkt.sub.set.desc.public,
          "private": pkt.sub.set.desc.private
        }
      }
    })
    msgs.push({
      "pres": {
        "topic": "me",
        "src": pkt.sub.topic,
        "what": "on"
      }
    })
    msgs.push({
      "meta": {
        "id": pkt.sub.id,
        "topic": pkt.sub.topic,
        "ts": timestamp,
        "sub": [{
          "updated": timestamp,
          "online": true,
          "acs": {
            "mode": "JRWPASDO",
            "given": "JRWPASDO",
            "want": "JRWPASDO"
          },
          "public": pkt.sub.set.desc.public,
          "private": pkt.sub.set.desc.private,
          "user": this._w_user
        }]
      }
    })
    msgs.push({
      "ctrl": {
        "id": pkt.sub.id,
        "topic": pkt.sub.topic,
        "ts": timestamp,
        "params": {
          "what": "data"
        },
        "code": 204,
        "text": "no content",
      }
    })
    return msgs
  }
  #w_processor(pkt) {
    switch (true) {
      case ('hi' in pkt): {
        let pkt2 = {
          "ctrl": {
            "id": pkt.hi.id,
            "params": {
              "build": "wallet:v0.0.1",
              "maxFileUploadSize": 33554432,
              "maxMessageSize": 4194304,
              "maxSubscriberCount": 32,
              "maxTagCount": 16,
              "maxTagLength": 96,
              "minTagLength": 2,
              "ver": "0.1"
            },
            "code": 201,
            "text": "created",
            "ts": rfc3339DateString(new Date())
          }
        };
        pkt2 = simplify(pkt2);
        let msg2 = JSON.stringify(pkt2);
        this.#dispatchMessage(msg2)
      }
      return
      case ('acc' in pkt):
      //{"acc":{"id":"66227","user":"new","scheme":"basic","secret":"VXNlcjE6MTIzNDU2","login":true,"desc":{"public":{"fn":"User One"}},"cred":[{"meth":"email","val":"userone@test.test"}]}} 
      {
        let timestamp = rfc3339DateString(new Date())
        let expireDate = new Date()
        let members = this._doc.getMap("members")
        pkt.acc.user = "usr" + uuidv4()
        this._w_user = pkt.acc.user
        pkt.acc.desc.created = timestamp
        pkt.acc.desc.updated = timestamp
        members.set(pkt.acc.user, pkt.acc)
        let devices = this._doc.getMap('devices')
        devices.set(pkt.acc.secret, pkt.acc.user)

        let personal = this._doc.getMap("personal")
        let personalTopics = new Y.Map()
        personal.set(pkt.acc.user, personalTopics)
        personalTopics.observe((ev) => {
          ev.target === personalTopics
          ev.changes.keys.forEach((change, key) => {
            if (change.action === 'add') {
              console.log(`Property "${key}" was added. Initial value: "${personalTopics.get(key)}".`)
              let actionActor = personalTopics.get(key)
              if (actionActor.tgt && actionActor.tgt == this._w_user) {
                {
                  let msgs = []
                  msgs.push({
                    "pres": {
                      "topic": "me",
                      "src": actionActor.act,
                      "what": "acs",
                      "act": actionActor.act,
                      "dacs": {
                        "want": "JRWPA",
                        "given": "JRWPA"
                      }
                    }
                  })
                  msgs.push({
                    "pres": {
                      "topic": "me",
                      "src": actionActor.act,
                      "what": "on"
                    }
                  })
                  for (let pkt3 of msgs) {
                    let pkt2 = simplify(pkt3);
                    let msg2 = JSON.stringify(pkt2);
                    this.#dispatchMessage(msg2)
                  }

                  let topicme = {
                    "sub": {
                      "id": "86617",
                      "topic": "me",
                      "get": {
                        "what": "sub desc tags cred"
                      }
                    }
                  }
                  this.#w_send(topicme, topicme.sub.id)
                }
              }
            } else if (change.action === 'update') {
              console.log(`Property "${key}" was updated. New value: "${personalTopics.get(key)}". Previous value: "${change.oldValue}".`)
            } else if (change.action === 'delete') {
              console.log(`Property "${key}" was deleted. New value: undefined. Previous value: "${change.oldValue}".`)
            }
          })
        })
        //{"ctrl":{"id":"66227","params":{"authlvl":"auth","desc":{"created":"2023-01-17T19:37:53.158Z","updated":"2023-01-17T19:37:53.158Z","defacs":{"auth":"JRWPAS","anon":"N"},"public":{"fn":"User One"}},"expires":"2023-01-31T19:37:53.225Z","token":"QWvgpJgI/sIRbtljFAABAAEAtsPqSJIe/S4GMuub5Pg4+pbLMuTw+ndK7xH64QFDiyw=","user":"usrQWvgpJgI_sI"},"code":200,"text":"ok","ts":"2023-01-17T19:37:53.158Z"}} 
        let topics = this._doc.getMap("topics")
        topics.set(pkt.acc.user, {
          "created": timestamp,
          "updated": timestamp,
          "defacs": {
            "auth": "JRWPAS",
            "anon": "N"
          },
          "public": pkt.acc.desc.public
        })

        let msg = {
          "ctrl": {
            "id": pkt.acc.id,
            "params": {
              "authlvl": "auth",
              "desc": {
                "created": timestamp,
                "updated": timestamp,
                "acs": {
                  "auth": "JRWPAS",
                  "anon": "N"
                },
                "public": pkt.acc.desc.public
              },
              "expires": rfc3339DateString(new Date(expireDate.setMonth(expireDate.getMonth() + 1))),
              "token": "QWvgpJgI/sIRbtljFAABAAEAtsPqSJIe/S4GMuub5Pg4+pbLMuTw+ndK7xH64QFDiyw=",
              "user": pkt.acc.user
            },
            "code": 200,
            "text": "ok",
            "ts": timestamp
          }
        };
        let pkt2 = simplify(msg);
        let msg2 = JSON.stringify(pkt2);
        this.#dispatchMessage(msg2)

      }
      return
      case ('login' in pkt): {

        let devices = this._doc.getMap('devices')
        let userId = devices.get(pkt.login.secret)

        if (!userId) {
          {
            let msg = {
              "ctrl": {
                "id": pkt.login.id,
                "code": 401,
                "text": "authentication failed",
                "ts": rfc3339DateString(new Date())
              }
            }

            let pkt2 = simplify(msg);
            let msg2 = JSON.stringify(pkt2);
            this.#dispatchMessage(msg2)
            return
          }
        }
        let members = this._doc.getMap("members")

        let usr = members.get(userId)
        this._w_user = usr.user
        let groups = this._doc.getMap("groups")
        groups.observe((ev) => {
          console.log("query new groups")
          let topicme = {
            "sub": {
              "id": "86617",
              "topic": "me",
              "get": {
                "what": "sub desc tags cred"
              }
            }
          }
          this.#w_send(topicme, topicme.sub.id)
        })

        let personal = this._doc.getMap("personal")
        let personalTopics = personal.get(usr.user)
        personalTopics.observe((ev) => {
          ev.target === personalTopics
          ev.changes.keys.forEach((change, key) => {
            if (change.action === 'add') {
              console.log(`Property "${key}" was added. Initial value: "${personalTopics.get(key)}".`)
              let actionActor = personalTopics.get(key)
              if (actionActor.tgt && actionActor.tgt == this._w_user) {
                {
                  let msgs = []
                  msgs.push({
                    "pres": {
                      "topic": "me",
                      "src": actionActor.act,
                      "what": "acs",
                      "act": actionActor.act,
                      "dacs": {
                        "want": "JRWPA",
                        "given": "JRWPA"
                      }
                    }
                  })
                  msgs.push({
                    "pres": {
                      "topic": "me",
                      "src": actionActor.act,
                      "what": "on"
                    }
                  })
                  for (let pkt3 of msgs) {
                    let pkt2 = simplify(pkt3);
                    let msg2 = JSON.stringify(pkt2);
                    this.#dispatchMessage(msg2)
                  }

                  let topicme = {
                    "sub": {
                      "id": "86617",
                      "topic": "me",
                      "get": {
                        "what": "sub desc tags cred"
                      }
                    }
                  }
                  this.#w_send(topicme, topicme.sub.id)
                }
              }
            } else if (change.action === 'update') {
              console.log(`Property "${key}" was updated. New value: "${personalTopics.get(key)}". Previous value: "${change.oldValue}".`)
            } else if (change.action === 'delete') {
              console.log(`Property "${key}" was deleted. New value: undefined. Previous value: "${change.oldValue}".`)
            }
          })
        })

        let expireDate = new Date()
        let pkt2 = {
          "ctrl": {
            "id": pkt.login.id,
            "params": {
              "authlvl": "auth",
              "expires": rfc3339DateString(new Date(expireDate.setMonth(expireDate.getMonth() + 1))),
              "token": "FqAz3xAXbJ21ENljFAABAAEAxFXu64+/vA9MxWQIpTlOYEDpBp7o9OUn1C4aLmLjaIg=",
              "user": usr.user
            },
            "code": 200,
            "text": "ok",
            "ts": rfc3339DateString(new Date())
          }
        };
        pkt2 = simplify(pkt2);
        let msg2 = JSON.stringify(pkt2);
        this.#dispatchMessage(msg2)
      }
      return
      case ('sub' in pkt): {
        let msgs
        // out: {"sub":{"id":"124198","topic":"new124196","set":{"desc":{"public":{"fn":"maksim_test","note":"maksim_grp_test"},"private":{"comment":"new topic"}},"tags":["maksim_test"]},"get":{"data":{"limit":24},"what":"data sub desc"}}} 
        // in: {"ctrl":{"id":"124198","topic":"grpvGmgnOuLMpo","params":{"acs":{"mode":"JRWPASDO","given":"JRWPASDO","want":"JRWPASDO"},"tmpname":"new124196"},"code":200,"text":"ok","ts":"2023-01-17T19:13:47.213Z"}} 
        // in: {"meta":{"id":"124198","topic":"grpvGmgnOuLMpo","ts":"2023-01-17T19:13:47.218Z","desc":{"created":"2023-01-17T19:13:47.213Z","updated":"2023-01-17T19:13:47.213Z","touched":"2023-01-17T19:13:47.213Z","online":true,"defacs":{"auth":"JRWPS","anon":"N"},"acs":{"mode":"JRWPASDO","given":"JRWPASDO","want":"JRWPASDO"},"public":{"fn":"maksim_test","note":"maksim_grp_test"},"private":{"comment":"new topic"}}}} 
        // in: {"pres":{"topic":"me","src":"grpvGmgnOuLMpo","what":"on"}} 
        // in: {"meta":{"id":"124198","topic":"grpvGmgnOuLMpo","ts":"2023-01-17T19:13:47.218Z","sub":[{"updated":"2023-01-17T19:13:47.217Z","online":true,"acs":{"mode":"JRWPASDO","given":"JRWPASDO","want":"JRWPASDO"},"public":{"fn":"maksim2"},"private":{"comment":"new topic"},"user":"usrFqAz3xAXbJ0"}]}} 
        // in: {"ctrl":{"id":"124198","topic":"grpvGmgnOuLMpo","params":{"what":"data"},"code":204,"text":"no content","ts":"2023-01-17T19:13:47.219Z"}} 
        // in: {"pres":{"topic":"me","src":"grpVQB3D-WI4TY","what":"off"}} 

        if (pkt.sub.topic == "me") {
          msgs = this.#w_topicme(pkt)
        } else if (pkt.sub.topic == "fnd") {
          //             out: {"sub":{"id":"106430","topic":"fnd","get":{"what":"sub"}}} 
          // in: {"ctrl":{"id":"106430","topic":"fnd","code":200,"text":"ok","ts":"2023-01-18T11:00:28.338Z"}} 
          // in: {"ctrl":{"id":"106430","topic":"fnd","params":{"what":"sub"},"code":204,"text":"no content","ts":"2023-01-18T11:00:28.338Z"}} 
          msgs = []
          msgs.push({
            "ctrl": {
              "id": pkt.sub.id,
              "topic": "fnd",
              "code": 200,
              "text": "ok",
              "ts": rfc3339DateString(new Date())
            }
          })
          msgs.push({
            "ctrl": {
              "id": pkt.sub.id,
              "topic": "fnd",
              "params": {
                "what": "sub"
              },
              "code": 204,
              "text": "no content",
              "ts": rfc3339DateString(new Date())
            }
          })

        } else if (pkt.sub.topic.startsWith("new")) {
          msgs = this.#w_create_grp(pkt)
        } else if (pkt.sub.topic.startsWith("usr")) {
          msgs = this.#w_topic_usr(pkt)
        } else {
          msgs = this.#w_topic_grp(pkt)
        }

        for (let pkt3 of msgs) {
          let pkt2 = simplify(pkt3);
          let msg2 = JSON.stringify(pkt2);
          this.#dispatchMessage(msg2)
        }
      }
      return


      case ('leave' in pkt):

      {
        let pkt2 = {
          "ctrl": {
            "id": pkt.leave.id,
            "topic": pkt.leave.topic,
            "ts": rfc3339DateString(new Date())
          }
        }
        pkt2 = simplify(pkt2);
        let msg2 = JSON.stringify(pkt2);
        this.#dispatchMessage(msg2)
      }
      return
      case ('pub' in pkt): {
        // out: {"pub":{"id":"124156","topic":"grpRtsg_xdcD14","noecho":true,"content":"msg1 quick"}} 
        // in: {"ctrl":{"id":"124156","topic":"grpRtsg_xdcD14","params":{"seq":7},"code":202,"text":"accepted","ts":"2023-01-17T17:36:14.694Z"}} 
        // out: {"note":{"topic":"grpRtsg_xdcD14","what":"read","seq":7}} 

        let groupMessages
        if (pkt.pub.topic.startsWith("usr")) {
          let personal = this._doc.getMap("personal")
          let persanalVault = personal.get(this._w_user)
          let chatMeta = persanalVault.get(pkt.pub.topic)
          groupMessages = this._doc.getArray(chatMeta.chatId)
        } else {
          groupMessages = this._doc.getArray(pkt.pub.topic)
        }
        if (!groupMessages) {
          throw new Error(`topic ${pkt.pub.topic} is not found`);
        }
        let seq = groupMessages.length + 1
        let msg = {
          "data": {
            "topic": pkt.pub.topic,
            "from": this._w_user,
            "ts": rfc3339DateString(new Date()),
            "seq": seq,
            "content": pkt.pub.content
          }
        }

        groupMessages.insert(0, [msg])

        let msgs = []
        msgs.push({
          "ctrl": {
            "id": pkt.pub.id,
            "topic": pkt.pub.topic,
            "params": {
              "seq": seq
            },
            "code": 202,
            "text": "accepted",
            "ts": rfc3339DateString(new Date()),
          }
        })
        msgs.push({
          "note": {
            "topic": pkt.pub.topic,
            "what": "read",
            "seq": seq
          }
        })
        for (let pkt3 of msgs) {
          let pkt2 = simplify(pkt3);
          let msg2 = JSON.stringify(pkt2);
          this.#dispatchMessage(msg2)
        }

      }
      return
      case ('get' in pkt): {
        // step 1
        // out: {"get":{"id":"66233","topic":"usrFqAz3xAXbJ0","what":"desc"}} 
        // in: {"meta":{"id":"66230","topic":"usrFqAz3xAXbJ0","ts":"2023-01-17T19:51:52.174Z","desc":{"created":"2022-12-28T19:22:09.912Z","updated":"2022-12-28T19:24:48.386Z","acs":{"mode":"JRWPAS"},"public":{"fn":"maksim2"}}}} 
        // step 2 
        // out: {"get":{"id":"124427","topic":"me","what":"sub","sub":{"topic":"usrI9KrInUCvMs"}}} 
        // in: {"meta":{"id":"124427","topic":"me","ts":"2023-01-18T11:19:13.337Z","sub":[{"updated":"2023-01-18T11:19:13.326Z","online":true,"acs":{"mode":"JRWPA","given":"JRWPA","want":"JRWPA"},"public":{"fn":"we"},"topic":"usrI9KrInUCvMs","touched":"2023-01-18T11:19:13.337Z","seq":1}]}} 



        if (pkt.get.topic == "me" && pkt.get.what == "sub") {
          {
            let topics = this._doc.getMap("topics")
            let desc = topics.get(pkt.get.sub.topic)
            if (desc === undefined) {
              throw new Error(`topic is not found: ${JSON.stringify(pkt)}`);
            }
            let msg = {
              "meta": {
                "id": pkt.get.id,
                "topic": "me",
                "ts": rfc3339DateString(new Date()),
                "sub": [{
                  "updated": rfc3339DateString(new Date()),
                  "online": true,
                  "acs": desc.acs,
                  "public": desc.public,
                  "topic": pkt.get.sub.topic,
                  "touched": rfc3339DateString(new Date()),
                  "seq": 1
                }]
              }
            }

            let pkt2 = simplify(msg);
            let msg2 = JSON.stringify(pkt2);
            this.#dispatchMessage(msg2)
            return
          }
        }

        let topics = this._doc.getMap("topics")
        let desc = topics.get(pkt.get.topic)
        if (desc === undefined) {
          throw new Error(`topic is not found: ${pkt}`);
        }
        let personal = this._doc.getMap("personal")

        let personalContacts = personal.get(this._w_user)
        let remoteContacts = personal.get(pkt.get.topic)
        if (!personalContacts.get(pkt.get.topic) && !remoteContacts.get(this._w_user)) {
          let chatId = this._w_user + pkt.get.topic
          remoteContacts.set(this._w_user, {
            tgt: pkt.get.topic,
            act: this._w_user,
            chatId: chatId
          })
          personalContacts.set(pkt.get.topic, {
            act: this._w_user,
            chatId: chatId
          })
          let initChat = this._doc.getArray(chatId)
          let helloMsg = {
            "data": {
              "topic": pkt.get.topic,
              "from": this._w_user,
              "ts": rfc3339DateString(new Date()),
              "seq": 1,
              "content": "Hello!"
            }
          }
          initChat.insert(0, [helloMsg])

          let topicme = {
            "sub": {
              "id": "86617",
              "topic": "me",
              "get": {
                "what": "sub desc tags cred"
              }
            }
          }
          this.#w_send(topicme, topicme.sub.id)
        }

        let msg = {
          "meta": {
            "id": pkt.get.id,
            "topic": pkt.get.topic,
            "ts": rfc3339DateString(new Date()),
            "desc": desc
          }
        }
        let pkt2 = simplify(msg);
        let msg2 = JSON.stringify(pkt2);
        this.#dispatchMessage(msg2)
      }
      return

      case ('set' in pkt):

        throw new Error(`packet type is not implemented: ${pkt}`);

      case ('del' in pkt):

        throw new Error(`packet type is not implemented: ${pkt}`);

      case ('note' in pkt):
        console.log("ignore", JSON.stringify(pkt))
        //throw new Error(`packet type is not implemented: ${pkt}`);
        break;
      default:
        throw new Error(`Unknown packet type requested: ${pkt}`);
    }
  }

  #w_pkg() {

  }

  #w_unpkg() {

  }

  // end wallet
  constructor(config, onComplete) {
    this._host = config.host;
    this._secure = config.secure;

    // Client-provided application name, format <Name>/<version number>
    this._appName = config.appName || "Undefined";

    // API Key.
    this._apiKey = config.apiKey;

    // Name and version of the browser.
    this._platform = config.platform || 'web';
    // Underlying OS.
    if (typeof navigator != 'undefined') {
      this._browser = getBrowserInfo(navigator.userAgent, navigator.product);
      this._hwos = navigator.platform;
      // This is the default language. It could be changed by client.
      this._humanLanguage = navigator.language || 'en-US';
    }

    Connection.logger = this.logger;
    Drafty.logger = this.logger;

    // WebSocket or long polling network connection.
    if (config.transport != 'lp' && config.transport != 'ws') {
      config.transport = detectTransport();
    }

    this.#init_storage()
    this.#init_wallet()

    /* devblock:start */
    /* devserver_start */
    this._connection = new Connection(config, Const.PROTOCOL_VERSION, /* autoreconnect */ true);
    this._connection.onMessage = (data) => {
      // Call the main message dispatcher.
      this.#dispatchMessage(data);
      this.#w_onMessage(data)
    }
    this._connection.onOpen = () => {
      // Ready to start sending.
      this.#connectionOpen();
    }
    this._connection.onDisconnect = (err, code) => {
      this.#disconnected(err, code);
    }
    // Wrapper for the reconnect iterator callback.
    this._connection.onAutoreconnectIteration = (timeout, promise) => {
      if (this.onAutoreconnectIteration) {
        this.onAutoreconnectIteration(timeout, promise);
      }
    }
    /* devserver_end */
    /* devblock:end */
    this._persist = config.persist;
    // Initialize object regardless. It simplifies the code.
    this._db = new DBCache(err => {
      this.logger('DB', err);
    }, this.logger);

    if (this._persist) {
      // Create the persistent cache.
      // Store promises to be resolved when messages load into memory.
      const prom = [];
      this._db.initDatabase().then(() => {
        // First load topics into memory.
        return this._db.mapTopics((data) => {
          let topic = this.#cacheGet('topic', data.name);
          if (topic) {
            return;
          }
          if (data.name == Const.TOPIC_ME) {
            topic = new TopicMe();
          } else if (data.name == Const.TOPIC_FND) {
            topic = new TopicFnd();
          } else {
            topic = new Topic(data.name);
          }
          this._db.deserializeTopic(topic, data);
          this.#attachCacheToTopic(topic);
          topic._cachePutSelf();
          // Topic loaded from DB is not new.
          delete topic._new;
          // Request to load messages and save the promise.
          prom.push(topic._loadMessages(this._db));
        });
      }).then(() => {
        // Then load users.
        return this._db.mapUsers((data) => {
          this.#cachePut('user', data.uid, mergeObj({}, data.public));
        });
      }).then(() => {
        // Now wait for all messages to finish loading.
        return Promise.all(prom);
      }).then(() => {
        if (onComplete) {
          onComplete();
        }
        this.logger("Persistent cache initialized.");
      }).catch((err) => {
        if (onComplete) {
          onComplete(err);
        }
        this.logger("Failed to initialize persistent cache:", err);
      });
    } else {
      this._db.deleteDatabase().then(() => {
        if (onComplete) {
          onComplete();
        }
      });
    }
  }

  // Private methods.

  // Console logger. Babel somehow fails to parse '...rest' parameter.
  logger(str, ...args) {
    if (this._loggingEnabled) {
      const d = new Date();
      const dateString = ('0' + d.getUTCHours()).slice(-2) + ':' +
        ('0' + d.getUTCMinutes()).slice(-2) + ':' +
        ('0' + d.getUTCSeconds()).slice(-2) + '.' +
        ('00' + d.getUTCMilliseconds()).slice(-3);

      console.log('[' + dateString + ']', str, args.join(' '));
    }
  }

  // Generator of default promises for sent packets.
  #makePromise(id) {
    let promise = null;
    if (id) {
      promise = new Promise((resolve, reject) => {
        // Stored callbacks will be called when the response packet with this Id arrives
        this._pendingPromises[id] = {
          'resolve': resolve,
          'reject': reject,
          'ts': new Date()
        };
      });
    }
    return promise;
  };

  // Resolve or reject a pending promise.
  // Unresolved promises are stored in _pendingPromises.
  #execPromise(id, code, onOK, errorText) {
    const callbacks = this._pendingPromises[id];
    if (callbacks) {
      delete this._pendingPromises[id];
      if (code >= 200 && code < 400) {
        if (callbacks.resolve) {
          callbacks.resolve(onOK);
        }
      } else if (callbacks.reject) {
        callbacks.reject(new Error(`${errorText} (${code})`));
      }
    }
  }

  // Send a packet. If packet id is provided return a promise.
  #send(pkt, id) {
    let promise;
    if (id) {
      promise = this.#makePromise(id);
    }
    pkt = simplify(pkt);
    let msg = JSON.stringify(pkt);
    this.logger("out: " + (this._trimLongStrings ? JSON.stringify(pkt, jsonLoggerHelper) : msg));
    try {
      this._connection.sendText(msg);
    } catch (err) {
      // If sendText throws, wrap the error in a promise or rethrow.
      if (id) {
        this.#execPromise(id, Connection.NETWORK_ERROR, null, err.message);
      } else {
        throw err;
      }
    }
    return promise;
  }

  // The main message dispatcher.
  #dispatchMessage(data) {
    // Skip empty response. This happens when LP times out.
    if (!data)
      return;

    this._inPacketCount++;

    // Send raw message to listener
    if (this.onRawMessage) {
      this.onRawMessage(data);
    }

    if (data === '0') {
      // Server response to a network probe.
      if (this.onNetworkProbe) {
        this.onNetworkProbe();
      }
      // No processing is necessary.
      return;
    }

    let pkt = JSON.parse(data, jsonParseHelper);
    if (!pkt) {
      this.logger("in: " + data);
      this.logger("ERROR: failed to parse data");
    } else {
      this.logger("in: " + (this._trimLongStrings ? JSON.stringify(pkt, jsonLoggerHelper) : data));

      // Send complete packet to listener
      if (this.onMessage) {
        this.onMessage(pkt);
      }

      if (pkt.ctrl) {
        // Handling {ctrl} message
        if (this.onCtrlMessage) {
          this.onCtrlMessage(pkt.ctrl);
        }

        // Resolve or reject a pending promise, if any
        if (pkt.ctrl.id) {
          this.#execPromise(pkt.ctrl.id, pkt.ctrl.code, pkt.ctrl, pkt.ctrl.text);
        }
        setTimeout(() => {
          if (pkt.ctrl.code == 205 && pkt.ctrl.text == 'evicted') {
            // User evicted from topic.
            const topic = this.#cacheGet('topic', pkt.ctrl.topic);
            if (topic) {
              topic._resetSub();
              if (pkt.ctrl.params && pkt.ctrl.params.unsub) {
                topic._gone();
              }
            }
          } else if (pkt.ctrl.code < 300 && pkt.ctrl.params) {
            if (pkt.ctrl.params.what == 'data') {
              // code=208, all messages received: "params":{"count":11,"what":"data"},
              const topic = this.#cacheGet('topic', pkt.ctrl.topic);
              if (topic) {
                topic._allMessagesReceived(pkt.ctrl.params.count);
              }
            } else if (pkt.ctrl.params.what == 'sub') {
              // code=204, the topic has no (refreshed) subscriptions.
              const topic = this.#cacheGet('topic', pkt.ctrl.topic);
              if (topic) {
                // Trigger topic.onSubsUpdated.
                topic._processMetaSub([]);
              }
            }
          }
        }, 0);
      } else {
        setTimeout(() => {
          if (pkt.meta) {
            // Handling a {meta} message.
            // Preferred API: Route meta to topic, if one is registered
            const topic = this.#cacheGet('topic', pkt.meta.topic);
            if (topic) {
              topic._routeMeta(pkt.meta);
            }

            if (pkt.meta.id) {
              this.#execPromise(pkt.meta.id, 200, pkt.meta, 'META');
            }

            // Secondary API: callback
            if (this.onMetaMessage) {
              this.onMetaMessage(pkt.meta);
            }
          } else if (pkt.data) {
            // Handling {data} message
            // Preferred API: Route data to topic, if one is registered
            const topic = this.#cacheGet('topic', pkt.data.topic);
            if (topic) {
              topic._routeData(pkt.data);
            }

            // Secondary API: Call callback
            if (this.onDataMessage) {
              this.onDataMessage(pkt.data);
            }
          } else if (pkt.pres) {
            // Handling {pres} message
            // Preferred API: Route presence to topic, if one is registered
            const topic = this.#cacheGet('topic', pkt.pres.topic);
            if (topic) {
              topic._routePres(pkt.pres);
            }

            // Secondary API - callback
            if (this.onPresMessage) {
              this.onPresMessage(pkt.pres);
            }
          } else if (pkt.info) {
            // {info} message - read/received notifications and key presses
            // Preferred API: Route {info}} to topic, if one is registered
            const topic = this.#cacheGet('topic', pkt.info.topic);
            if (topic) {
              topic._routeInfo(pkt.info);
            }

            // Secondary API - callback
            if (this.onInfoMessage) {
              this.onInfoMessage(pkt.info);
            }
          } else {
            this.logger("ERROR: Unknown packet received.");
          }
        }, 0);
      }
    }
  }

  // Connection open, ready to start sending.
  #connectionOpen() {
    if (!this._expirePromises) {
      // Reject promises which have not been resolved for too long.
      this._expirePromises = setInterval(() => {
        const err = new Error("Timeout (504)");
        const expires = new Date(new Date().getTime() - Const.EXPIRE_PROMISES_TIMEOUT);
        for (let id in this._pendingPromises) {
          let callbacks = this._pendingPromises[id];
          if (callbacks && callbacks.ts < expires) {
            this.logger("Promise expired", id);
            delete this._pendingPromises[id];
            if (callbacks.reject) {
              callbacks.reject(err);
            }
          }
        }
      }, Const.EXPIRE_PROMISES_PERIOD);
    }
    this.hello();
  }

  #disconnected(err, code) {
    this._inPacketCount = 0;
    this._serverInfo = null;
    this._authenticated = false;

    if (this._expirePromises) {
      clearInterval(this._expirePromises);
      this._expirePromises = null;
    }

    // Mark all topics as unsubscribed
    this.#cacheMap('topic', (topic, key) => {
      topic._resetSub();
    });

    // Reject all pending promises
    for (let key in this._pendingPromises) {
      const callbacks = this._pendingPromises[key];
      if (callbacks && callbacks.reject) {
        callbacks.reject(err);
      }
    }
    this._pendingPromises = {};

    if (this.onDisconnect) {
      this.onDisconnect(err);
    }
  }

  // Get User Agent string
  #getUserAgent() {
    return this._appName + ' (' + (this._browser ? this._browser + '; ' : '') + this._hwos + '); ' + Const.LIBRARY;
  }

  // Generator of packets stubs
  #initPacket(type, topic) {
    switch (type) {
      case 'hi':
        return {
          'hi': {
            'id': this.getNextUniqueId(),
            'ver': Const.VERSION,
            'ua': this.#getUserAgent(),
            'dev': this._deviceToken,
            'lang': this._humanLanguage,
            'platf': this._platform
          }
        };

      case 'acc':
        return {
          'acc': {
            'id': this.getNextUniqueId(),
            'user': null,
            'scheme': null,
            'secret': null,
            'login': false,
            'tags': null,
            'desc': {},
            'cred': {}
          }
        };

      case 'login':
        return {
          'login': {
            'id': this.getNextUniqueId(),
            'scheme': null,
            'secret': null
          }
        };

      case 'sub':
        return {
          'sub': {
            'id': this.getNextUniqueId(),
            'topic': topic,
            'set': {},
            'get': {}
          }
        };

      case 'leave':
        return {
          'leave': {
            'id': this.getNextUniqueId(),
            'topic': topic,
            'unsub': false
          }
        };

      case 'pub':
        return {
          'pub': {
            'id': this.getNextUniqueId(),
            'topic': topic,
            'noecho': false,
            'head': null,
            'content': {}
          }
        };

      case 'get':
        return {
          'get': {
            'id': this.getNextUniqueId(),
            'topic': topic,
            'what': null,
            'desc': {},
            'sub': {},
            'data': {}
          }
        };

      case 'set':
        return {
          'set': {
            'id': this.getNextUniqueId(),
            'topic': topic,
            'desc': {},
            'sub': {},
            'tags': []
          }
        };

      case 'del':
        return {
          'del': {
            'id': this.getNextUniqueId(),
            'topic': topic,
            'what': null,
            'delseq': null,
            'user': null,
            'hard': false
          }
        };

      case 'note':
        return {
          'note': {
            // no id by design
            'topic': topic,
            'what': null,
            'seq': undefined // the server-side message id aknowledged as received or read
          }
        };

      default:
        throw new Error(`Unknown packet type requested: ${type}`);
    }
  }

  // Cache management
  #cachePut(type, name, obj) {
    this._cache[type + ':' + name] = obj;
  }
  #cacheGet(type, name) {
    return this._cache[type + ':' + name];
  }
  #cacheDel(type, name) {
    delete this._cache[type + ':' + name];
  }

  // Enumerate all items in cache, call func for each item.
  // Enumeration stops if func returns true.
  #cacheMap(type, func, context) {
    const key = type ? type + ':' : undefined;
    for (let idx in this._cache) {
      if (!key || idx.indexOf(key) == 0) {
        if (func.call(context, this._cache[idx], idx)) {
          break;
        }
      }
    }
  }

  // Make limited cache management available to topic.
  // Caching user.public only. Everything else is per-topic.
  #attachCacheToTopic(topic) {
    topic._tinode = this;

    topic._cacheGetUser = (uid) => {
      const pub = this.#cacheGet('user', uid);
      if (pub) {
        return {
          user: uid,
          public: mergeObj({}, pub)
        };
      }
      return undefined;
    };
    topic._cachePutUser = (uid, user) => {
      this.#cachePut('user', uid, mergeObj({}, user.public));
    };
    topic._cacheDelUser = (uid) => {
      this.#cacheDel('user', uid);
    };
    topic._cachePutSelf = _ => {
      this.#cachePut('topic', topic.name, topic);
    };
    topic._cacheDelSelf = _ => {
      this.#cacheDel('topic', topic.name);
    };
  }

  // On successful login save server-provided data.
  #loginSuccessful(ctrl) {
    if (!ctrl.params || !ctrl.params.user) {
      return ctrl;
    }
    // This is a response to a successful login,
    // extract UID and security token, save it in Tinode module
    this._myUID = ctrl.params.user;
    this._authenticated = (ctrl && ctrl.code >= 200 && ctrl.code < 300);
    if (ctrl.params && ctrl.params.token && ctrl.params.expires) {
      this._authToken = {
        token: ctrl.params.token,
        expires: ctrl.params.expires
      };
    } else {
      this._authToken = null;
    }

    if (this.onLogin) {
      this.onLogin(ctrl.code, ctrl.text);
    }

    return ctrl;
  }

  // Static methods.
  /**
   * Helper method to package account credential.
   *
   * @memberof Tinode
   * @static
   *
   * @param {string | Credential} meth - validation method or object with validation data.
   * @param {string=} val - validation value (e.g. email or phone number).
   * @param {Object=} params - validation parameters.
   * @param {string=} resp - validation response.
   *
   * @returns {Array.<Credential>} array with a single credential or <code>null</code> if no valid credentials were given.
   */
  static credential(meth, val, params, resp) {
    if (typeof meth == 'object') {
      ({
        val,
        params,
        resp,
        meth
      } = meth);
    }
    if (meth && (val || resp)) {
      return [{
        'meth': meth,
        'val': val,
        'resp': resp,
        'params': params
      }];
    }
    return null;
  }

  /**
   * Determine topic type from topic's name: grp, p2p, me, fnd, sys.
   * @memberof Tinode
   * @static
   *
   * @param {string} name - Name of the topic to test.
   * @returns {string} One of <code>"me"</code>, <code>"fnd"</code>, <code>"sys"</code>, <code>"grp"</code>,
   *    <code>"p2p"</code> or <code>undefined</code>.
   */
  static topicType(name) {
    return Topic.topicType(name);
  }

  /**
   * Check if the given topic name is a name of a 'me' topic.
   * @memberof Tinode
   * @static
   *
   * @param {string} name - Name of the topic to test.
   * @returns {boolean} <code>true</code> if the name is a name of a 'me' topic, <code>false</code> otherwise.
   */
  static isMeTopicName(name) {
    return Topic.isMeTopicName(name);
  }
  /**
   * Check if the given topic name is a name of a group topic.
   * @memberof Tinode
   * @static
   *
   * @param {string} name - Name of the topic to test.
   * @returns {boolean} <code>true</code> if the name is a name of a group topic, <code>false</code> otherwise.
   */
  static isGroupTopicName(name) {
    return Topic.isGroupTopicName(name);
  }
  /**
   * Check if the given topic name is a name of a p2p topic.
   * @memberof Tinode
   * @static
   *
   * @param {string} name - Name of the topic to test.
   * @returns {boolean} <code>true</code> if the name is a name of a p2p topic, <code>false</code> otherwise.
   */
  static isP2PTopicName(name) {
    return Topic.isP2PTopicName(name);
  }
  /**
   * Check if the given topic name is a name of a communication topic, i.e. P2P or group.
   * @memberof Tinode
   * @static
   *
   * @param {string} name - Name of the topic to test.
   * @returns {boolean} <code>true</code> if the name is a name of a p2p or group topic, <code>false</code> otherwise.
   */
  static isCommTopicName(name) {
    return Topic.isCommTopicName(name);
  }
  /**
   * Check if the topic name is a name of a new topic.
   * @memberof Tinode
   * @static
   *
   * @param {string} name - topic name to check.
   * @returns {boolean} <code>true</code> if the name is a name of a new topic, <code>false</code> otherwise.
   */
  static isNewGroupTopicName(name) {
    return Topic.isNewGroupTopicName(name);
  }
  /**
   * Check if the topic name is a name of a channel.
   * @memberof Tinode
   * @static
   *
   * @param {string} name - topic name to check.
   * @returns {boolean} <code>true</code> if the name is a name of a channel, <code>false</code> otherwise.
   */
  static isChannelTopicName(name) {
    return Topic.isChannelTopicName(name);
  }
  /**
   * Return information about the current version of this Tinode client library.
   * @memberof Tinode
   * @static
   *
   * @returns {string} semantic version of the library, e.g. <code>"0.15.5-rc1"</code>.
   */
  static getVersion() {
    return Const.VERSION;
  }
  /**
   * To use Tinode in a non browser context, supply WebSocket and XMLHttpRequest providers.
   * @static
   * @memberof Tinode
   * @param wsProvider <code>WebSocket</code> provider, e.g. for nodeJS , <code>require('ws')</code>.
   * @param xhrProvider <code>XMLHttpRequest</code> provider, e.g. for node <code>require('xhr')</code>.
   */
  static setNetworkProviders(wsProvider, xhrProvider) {
    WebSocketProvider = wsProvider;
    XHRProvider = xhrProvider;

    Connection.setNetworkProviders(WebSocketProvider, XHRProvider);
    LargeFileHelper.setNetworkProvider(XHRProvider);
  }
  /**
   * To use Tinode in a non browser context, supply <code>indexedDB</code> provider.
   * @static
   * @memberof Tinode
   * @param idbProvider <code>indexedDB</code> provider, e.g. for nodeJS , <code>require('fake-indexeddb')</code>.
   */
  static setDatabaseProvider(idbProvider) {
    IndexedDBProvider = idbProvider;

    DBCache.setDatabaseProvider(IndexedDBProvider);
  }
  /**
   * Return information about the current name and version of this Tinode library.
   * @memberof Tinode
   * @static
   *
   * @returns {string} the name of the library and it's version.
   */
  static getLibrary() {
    return Const.LIBRARY;
  }
  /**
   * Check if the given string represents <code>NULL</code> value as defined by Tinode (<code>'\u2421'</code>).
   * @memberof Tinode
   * @static
   *
   * @param {string} str - string to check for <code>NULL</code> value.
   *
   * @returns {boolean} <code>true</code> if string represents <code>NULL</code> value, <code>false</code> otherwise.
   */
  static isNullValue(str) {
    return str === Const.DEL_CHAR;
  }
  /**
   * Check if the given URL string is a relative URL.
   * Check for cases like:
   *  <code>'http://example.com'</code>
   *  <code>' http://example.com'</code>
   *  <code>'//example.com/'</code>
   *  <code>'http:example.com'</code>
   *  <code>'http:/example.com'</code>
   * @memberof Tinode
   * @static
   *
   * @param {string} url - URL string to check.
   *
   * @returns {boolean} <code>true</code> if the URL is relative, <code>false</code> otherwise.
   */
  static isRelativeURL(url) {
    return !/^\s*([a-z][a-z0-9+.-]*:|\/\/)/im.test(url);
  }

  // Instance methods.

  // Generates unique message IDs
  getNextUniqueId() {
    return (this._messageId != 0) ? '' + this._messageId++ : undefined;
  };

  /**
   * Connect to the server.
   * @memberof Tinode#
   *
   * @param {string} host_ - name of the host to connect to.
   *
   * @return {Promise} Promise resolved/rejected when the connection call completes:
   *    <code>resolve()</code> is called without parameters, <code>reject()</code> receives the
   *    <code>Error</code> as a single parameter.
   */
  connect(host_) {
    let promise = new Promise((resolve, reject) => {
      // Stored callbacks will be called when the response packet with this Id arrives
      resolve()
    });
    return promise;
  }

  /**
   * Attempt to reconnect to the server immediately.
   * @memberof Tinode#
   *
   * @param {string} force - reconnect even if there is a connection already.
   */
  reconnect(force) {
    this._connection.reconnect(force);
  }

  /**
   * Disconnect from the server.
   * @memberof Tinode#
   */
  disconnect() {
    this._connection.disconnect();
  }

  /**
   * Clear persistent cache: remove IndexedDB.
   * @memberof Tinode#
   * @return {Promise} Promise resolved/rejected when the operation is completed.
   */
  clearStorage() {
    if (this._db.isReady()) {
      return this._db.deleteDatabase();
    }
    return Promise.resolve();
  }

  /**
   * Initialize persistent cache: create IndexedDB cache.
   * @memberof Tinode#
   * @return {Promise} Promise resolved/rejected when the operation is completed.
   */
  initStorage() {
    if (!this._db.isReady()) {
      return this._db.initDatabase();
    }
    return Promise.resolve();
  }

  /**
   * Send a network probe message to make sure the connection is alive.
   * @memberof Tinode#
   */
  networkProbe() {
    this._connection.probe();
  }

  /**
   * Check for live connection to server.
   * @memberof Tinode#
   *
   * @returns {boolean} <code>true</code> if there is a live connection, <code>false</code> otherwise.
   */
  isConnected() {
    return this._w_isConnected
  }

  /**
   * Check if connection is authenticated (last login was successful).
   * @memberof Tinode#
   * @returns {boolean} <code>true</code> if authenticated, <code>false</code> otherwise.
   */
  isAuthenticated() {
    return this._authenticated;
  }

  /**
   * Add API key and auth token to the relative URL making it usable for getting data
   * from the server in a simple <code>HTTP GET</code> request.
   * @memberof Tinode#
   *
   * @param {string} URL - URL to wrap.
   * @returns {string} URL with appended API key and token, if valid token is present.
   */
  authorizeURL(url) {
    if (typeof url != 'string') {
      return url;
    }

    if (Tinode.isRelativeURL(url)) {
      // Fake base to make the relative URL parseable.
      const base = 'scheme://host/';
      const parsed = new URL(url, base);
      if (this._apiKey) {
        parsed.searchParams.append('apikey', this._apiKey);
      }
      if (this._authToken && this._authToken.token) {
        parsed.searchParams.append('auth', 'token');
        parsed.searchParams.append('secret', this._authToken.token);
      }
      // Convert back to string and strip fake base URL except for the root slash.
      url = parsed.toString().substring(base.length - 1);
    }
    return url;
  }

  /**
   * @typedef AccountParams
   * @memberof Tinode
   * @type {Object}
   * @property {Tinode.DefAcs=} defacs - Default access parameters for user's <code>me</code> topic.
   * @property {Object=} public - Public application-defined data exposed on <code>me</code> topic.
   * @property {Object=} private - Private application-defined data accessible on <code>me</code> topic.
   * @property {Object=} trusted - Trusted user data which can be set by a root user only.
   * @property {Array.<string>} tags - array of string tags for user discovery.
   * @property {string=} token - authentication token to use.
   * @property {Array.<string>=} attachments - Array of references to out of band attachments used in account description.
   */
  /**
   * @typedef DefAcs
   * @memberof Tinode
   * @type {Object}
   * @property {string=} auth - Access mode for <code>me</code> for authenticated users.
   * @property {string=} anon - Access mode for <code>me</code> for anonymous users.
   */

  /**
   * Create or update an account.
   * @memberof Tinode#
   *
   * @param {string} uid - User id to update
   * @param {string} scheme - Authentication scheme; <code>"basic"</code> and <code>"anonymous"</code> are the currently supported schemes.
   * @param {string} secret - Authentication secret, assumed to be already base64 encoded.
   * @param {boolean=} login - Use new account to authenticate current session
   * @param {Tinode.AccountParams=} params - User data to pass to the server.
   *
   * @returns {Promise} Promise which will be resolved/rejected when server reply is received.
   */
  account(uid, scheme, secret, login, params) {
    const pkt = this.#initPacket('acc');
    pkt.acc.user = uid;
    pkt.acc.scheme = scheme;
    pkt.acc.secret = secret;
    // Log in to the new account using selected scheme
    pkt.acc.login = login;

    if (params) {
      pkt.acc.desc.defacs = params.defacs;
      pkt.acc.desc.public = params.public;
      pkt.acc.desc.private = params.private;
      pkt.acc.desc.trusted = params.trusted;

      pkt.acc.tags = params.tags;
      pkt.acc.cred = params.cred;

      pkt.acc.token = params.token;

      if (Array.isArray(params.attachments) && params.attachments.length > 0) {
        pkt.extra = {
          attachments: params.attachments.filter(ref => Tinode.isRelativeURL(ref))
        };
      }
    }


    return this.#w_send(pkt, pkt.acc.id);;
  }

  /**
   * Create a new user. Wrapper for {@link Tinode#account}.
   * @memberof Tinode#
   *
   * @param {string} scheme - Authentication scheme; <code>"basic"</code> is the only currently supported scheme.
   * @param {string} secret - Authentication.
   * @param {boolean=} login - Use new account to authenticate current session
   * @param {Tinode.AccountParams=} params - User data to pass to the server.
   *
   * @returns {Promise} Promise which will be resolved/rejected when server reply is received.
   */
  createAccount(scheme, secret, login, params) {
    let promise = this.account(Const.USER_NEW, scheme, secret, login, params);
    if (login) {
      promise = promise.then((ctrl) => {
        return this.#loginSuccessful(ctrl);
      });
    }
    return promise;
  }

  /**
   * Create user with <code>'basic'</code> authentication scheme and immediately
   * use it for authentication. Wrapper for {@link Tinode#account}.
   * @memberof Tinode#
   *
   * @param {string} username - Login to use for the new account.
   * @param {string} password - User's password.
   * @param {Tinode.AccountParams=} params - User data to pass to the server.
   *
   * @returns {Promise} Promise which will be resolved/rejected when server reply is received.
   */
  createAccountBasic(username, password, params) {
    // Make sure we are not using 'null' or 'undefined';
    username = username || '';
    password = password || '';
    return this.createAccount('basic',
      b64EncodeUnicode(username + ':' + password), true, params);
  }

  /**
   * Update user's credentials for <code>'basic'</code> authentication scheme. Wrapper for {@link Tinode#account}.
   * @memberof Tinode#
   *
   * @param {string} uid - User ID to update.
   * @param {string} username - Login to use for the new account.
   * @param {string} password - User's password.
   * @param {Tinode.AccountParams=} params - data to pass to the server.
   *
   * @returns {Promise} Promise which will be resolved/rejected when server reply is received.
   */
  updateAccountBasic(uid, username, password, params) {
    // Make sure we are not using 'null' or 'undefined';
    username = username || '';
    password = password || '';
    return this.account(uid, 'basic',
      b64EncodeUnicode(username + ':' + password), false, params);
  }

  /**
   * Send handshake to the server.
   * @memberof Tinode#
   *
   * @returns {Promise} Promise which will be resolved/rejected when server reply is received.
   */
  hello() {
    const pkt = this.#initPacket('hi');

    return this.#w_send(pkt, pkt.hi.id)
      .then((ctrl) => {
        // Reset backoff counter on successful connection.
        // this._connection.backoffReset();

        // Server response contains server protocol version, build, constraints,
        // session ID for long polling. Save them.
        if (ctrl.params) {
          this._serverInfo = ctrl.params;
        }

        if (this.onConnect) {
          this.onConnect();
        }

        return ctrl;
      }).catch((err) => {
        this.logger("hello", err)
        // this._connection.reconnect(true);

        if (this.onDisconnect) {
          this.onDisconnect(err);
        }
      });
  }

  /**
   * Set or refresh the push notifications/device token. If the client is connected,
   * the deviceToken can be sent to the server.
   *
   * @memberof Tinode#
   * @param {string} dt - token obtained from the provider or <code>false</code>,
   *    <code>null</code> or <code>undefined</code> to clear the token.
   *
   * @returns <code>true</code> if attempt was made to send the update to the server.
   */
  setDeviceToken(dt) {
    let sent = false;
    // Convert any falsish value to null.
    dt = dt || null;
    if (dt != this._deviceToken) {
      this._deviceToken = dt;
      if (this.isConnected() && this.isAuthenticated()) {
        this.#w_send({
          'hi': {
            'dev': dt || Tinode.DEL_CHAR
          }
        });
        this.#send({
          'hi': {
            'dev': dt || Tinode.DEL_CHAR
          }
        });
        sent = true;
      }
    }
    return sent;
  }

  /**
   * @typedef Credential
   * @type {Object}
   * @property {string} meth - validation method.
   * @property {string} val - value to validate (e.g. email or phone number).
   * @property {string} resp - validation response.
   * @property {Object} params - validation parameters.
   */
  /**
   * Authenticate current session.
   * @memberof Tinode#
   *
   * @param {string} scheme - Authentication scheme; <code>"basic"</code> is the only currently supported scheme.
   * @param {string} secret - Authentication secret, assumed to be already base64 encoded.
   * @param {Credential=} cred - credential confirmation, if required.
   *
   * @returns {Promise} Promise which will be resolved/rejected when server reply is received.
   */
  login(scheme, secret, cred) {
    const pkt = this.#initPacket('login');
    pkt.login.scheme = scheme;
    pkt.login.secret = secret;
    pkt.login.cred = cred;


    return this.#w_send(pkt, pkt.login.id)
      .then((ctrl) => {
        return this.#loginSuccessful(ctrl);
      });
  }

  /**
   * Wrapper for {@link Tinode#login} with basic authentication
   * @memberof Tinode#
   *
   * @param {string} uname - User name.
   * @param {string} password  - Password.
   * @param {Credential=} cred - credential confirmation, if required.
   *
   * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
   */
  loginBasic(uname, password, cred) {
    return this.login('basic', b64EncodeUnicode(uname + ':' + password), cred)
      .then((ctrl) => {
        this._login = uname;
        return ctrl;
      });
  }

  /**
   * Wrapper for {@link Tinode#login} with token authentication
   * @memberof Tinode#
   *
   * @param {string} token - Token received in response to earlier login.
   * @param {Credential=} cred - credential confirmation, if required.
   *
   * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
   */
  loginToken(token, cred) {
    return this.login('token', token, cred);
  }

  /**
   * Send a request for resetting an authentication secret.
   * @memberof Tinode#
   *
   * @param {string} scheme - authentication scheme to reset.
   * @param {string} method - method to use for resetting the secret, such as "email" or "tel".
   * @param {string} value - value of the credential to use, a specific email address or a phone number.
   *
   * @returns {Promise} Promise which will be resolved/rejected on receiving the server reply.
   */
  requestResetAuthSecret(scheme, method, value) {
    return this.login('reset', b64EncodeUnicode(scheme + ':' + method + ':' + value));
  }

  /**
   * @typedef AuthToken
   * @memberof Tinode
   * @type {Object}
   * @property {string} token - Token value.
   * @property {Date} expires - Token expiration time.
   */
  /**
   * Get stored authentication token.
   * @memberof Tinode#
   *
   * @returns {Tinode.AuthToken} authentication token.
   */
  getAuthToken() {
    if (this._authToken && (this._authToken.expires.getTime() > Date.now())) {
      return this._authToken;
    } else {
      this._authToken = null;
    }
    return null;
  }

  /**
   * Application may provide a saved authentication token.
   * @memberof Tinode#
   *
   * @param {Tinode.AuthToken} token - authentication token.
   */
  setAuthToken(token) {
    this._authToken = token;
  }

  /**
   * @typedef SetParams
   * @type {Object}
   * @memberof Tinode
   * @property {Tinode.SetDesc=} desc - Topic initialization parameters when creating a new topic or a new subscription.
   * @property {Tinode.SetSub=} sub - Subscription initialization parameters.
   * @property {Array.<string>=} attachments - URLs of out of band attachments used in parameters.
   */
  /**
   * @typedef SetDesc
   * @type {Object}
   * @memberof Tinode
   * @property {Tinode.DefAcs=} defacs - Default access mode.
   * @property {Object=} public - Free-form topic description, publically accessible.
   * @property {Object=} private - Free-form topic description accessible only to the owner.
   * @property {Object=} trusted - Trusted user data which can be set by a root user only.
   */
  /**
   * @typedef SetSub
   * @type {Object}
   * @memberof Tinode
   * @property {string=} user - UID of the user affected by the request. Default (empty) - current user.
   * @property {string=} mode - User access mode, either requested or assigned dependent on context.
   */
  /**
   * Parameters passed to {@link Tinode#subscribe}.
   *
   * @typedef SubscriptionParams
   * @type {Object}
   * @memberof Tinode
   * @property {Tinode.SetParams=} set - Parameters used to initialize topic
   * @property {Tinode.GetQuery=} get - Query for fetching data from topic.
   */

  /**
   * Send a topic subscription request.
   * @memberof Tinode#
   *
   * @param {string} topic - Name of the topic to subscribe to.
   * @param {Tinode.GetQuery=} getParams - Optional subscription metadata query
   * @param {Tinode.SetParams=} setParams - Optional initialization parameters
   *
   * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
   */
  subscribe(topicName, getParams, setParams) {
    const pkt = this.#initPacket('sub', topicName)
    if (!topicName) {
      topicName = Const.TOPIC_NEW;
    }

    pkt.sub.get = getParams;

    if (setParams) {
      if (setParams.sub) {
        pkt.sub.set.sub = setParams.sub;
      }

      if (setParams.desc) {
        const desc = setParams.desc;
        if (Tinode.isNewGroupTopicName(topicName)) {
          // Full set.desc params are used for new topics only
          pkt.sub.set.desc = desc;
        } else if (Tinode.isP2PTopicName(topicName) && desc.defacs) {
          // Use optional default permissions only.
          pkt.sub.set.desc = {
            defacs: desc.defacs
          };
        }
      }

      // See if external objects were used in topic description.
      if (Array.isArray(setParams.attachments) && setParams.attachments.length > 0) {
        pkt.extra = {
          attachments: setParams.attachments.filter(ref => Tinode.isRelativeURL(ref))
        };
      }

      if (setParams.tags) {
        pkt.sub.set.tags = setParams.tags;
      }
    }

    return this.#w_send(pkt, pkt.sub.id);
  }

  /**
   * Detach and optionally unsubscribe from the topic
   * @memberof Tinode#
   *
   * @param {string} topic - Topic to detach from.
   * @param {boolean} unsub - If <code>true</code>, detach and unsubscribe, otherwise just detach.
   *
   * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
   */
  leave(topic, unsub) {
    const pkt = this.#initPacket('leave', topic);
    pkt.leave.unsub = unsub;

    return this.#w_send(pkt, pkt.leave.id);
    // return this.#send(pkt, pkt.leave.id);
  }

  /**
   * Create message draft without sending it to the server.
   * @memberof Tinode#
   *
   * @param {string} topic - Name of the topic to publish to.
   * @param {Object} content - Payload to publish.
   * @param {boolean=} noEcho - If <code>true</code>, tell the server not to echo the message to the original session.
   *
   * @returns {Object} new message which can be sent to the server or otherwise used.
   */
  createMessage(topic, content, noEcho) {
    const pkt = this.#initPacket('pub', topic);

    let dft = typeof content == 'string' ? Drafty.parse(content) : content;
    if (dft && !Drafty.isPlainText(dft)) {
      pkt.pub.head = {
        mime: Drafty.getContentType()
      };
      content = dft;
    }
    pkt.pub.noecho = noEcho;
    pkt.pub.content = content;

    return pkt.pub;
  }

  /**
   * Publish {data} message to topic.
   * @memberof Tinode#
   *
   * @param {string} topicName - Name of the topic to publish to.
   * @param {Object} content - Payload to publish.
   * @param {boolean=} noEcho - If <code>true</code>, tell the server not to echo the message to the original session.
   *
   * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
   */
  publish(topicName, content, noEcho) {
    return this.publishMessage(
      this.createMessage(topicName, content, noEcho)
    );
  }

  /**
   * Publish message to topic. The message should be created by {@link Tinode#createMessage}.
   * @memberof Tinode#
   *
   * @param {Object} pub - Message to publish.
   * @param {Array.<string>=} attachments - array of URLs with attachments.
   *
   * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
   */
  publishMessage(pub, attachments) {
    // Make a shallow copy. Needed in order to clear locally-assigned temp values;
    pub = Object.assign({}, pub);
    pub.seq = undefined;
    pub.from = undefined;
    pub.ts = undefined;
    const msg = {
      pub: pub,
    };
    if (attachments) {
      msg.extra = {
        attachments: attachments.filter(ref => Tinode.isRelativeURL(ref))
      };
    }
    return this.#w_send(msg, pub.id);
    // return this.#send(msg, pub.id);
  }

  /**
   * Out of band notification: notify topic that an external (push) notification was recived by the client.
   * @memberof Tinode#
   *
   * @param {object} data - notification payload.
   * @param {string} data.what - notification type, 'msg', 'read', 'sub'.
   * @param {string} data.topic - name of the updated topic.
   * @param {number=} data.seq - seq ID of the affected message.
   * @param {string=} data.xfrom - UID of the sender.
   * @param {object=} data.given - new subscription 'given', e.g. 'ASWP...'.
   * @param {object=} data.want - new subscription 'want', e.g. 'RWJ...'.
   */
  oobNotification(data) {
    switch (data.what) {
      case 'msg':
        const topic = this.#cacheGet('topic', data.topic);
        if (topic && topic.isChannelType()) {
          topic._updateReceived(data.seq, 'fake-uid');
          this.getMeTopic()._refreshContact('msg', topic);
        }
        break;
      case 'read':
        this.getMeTopic()._routePres({
          what: 'read',
          seq: data.seq
        });
        break;
      case 'sub':
        let mode = {
          given: data.modeGiven,
          want: data.modeWant
        };
        let acs = new AccessMode(mode);
        let pres = (!acs.mode || acs.mode == AccessMode._NONE) ?
          // Subscription deleted.
          {
            what: 'gone',
            src: data.topic
          } :
          // New subscription or subscription updated.
          {
            what: 'acs',
            src: data.topic,
            dacs: mode
          };
        this.getMeTopic()._routePres(pres);
        break;
      default:
        this.logger("Unknown push type ignored", data.what);
    }
  }

  /**
   * @typedef GetQuery
   * @type {Object}
   * @memberof Tinode
   * @property {Tinode.GetOptsType=} desc - If provided (even if empty), fetch topic description.
   * @property {Tinode.GetOptsType=} sub - If provided (even if empty), fetch topic subscriptions.
   * @property {Tinode.GetDataType=} data - If provided (even if empty), get messages.
   */

  /**
   * @typedef GetOptsType
   * @type {Object}
   * @memberof Tinode
   * @property {Date=} ims - "If modified since", fetch data only it was was modified since stated date.
   * @property {number=} limit - Maximum number of results to return. Ignored when querying topic description.
   */

  /**
   * @typedef GetDataType
   * @type {Object}
   * @memberof Tinode
   * @property {number=} since - Load messages with seq id equal or greater than this value.
   * @property {number=} before - Load messages with seq id lower than this number.
   * @property {number=} limit - Maximum number of results to return.
   */

  /**
   * Request topic metadata
   * @memberof Tinode#
   *
   * @param {string} topic - Name of the topic to query.
   * @param {Tinode.GetQuery} params - Parameters of the query. Use {@link Tinode.MetaGetBuilder} to generate.
   *
   * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
   */
  getMeta(topic, params) {
    const pkt = this.#initPacket('get', topic);

    pkt.get = mergeObj(pkt.get, params);



    return this.#w_send(pkt, pkt.get.id);
  }

  /**
   * Update topic's metadata: description, subscribtions.
   * @memberof Tinode#
   *
   * @param {string} topic - Topic to update.
   * @param {Tinode.SetParams} params - topic metadata to update.
   * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
   */
  setMeta(topic, params) {
    const pkt = this.#initPacket('set', topic);
    const what = [];

    if (params) {
      ['desc', 'sub', 'tags', 'cred'].forEach(function(key) {
        if (params.hasOwnProperty(key)) {
          what.push(key);
          pkt.set[key] = params[key];
        }
      });

      if (Array.isArray(params.attachments) && params.attachments.length > 0) {
        pkt.extra = {
          attachments: params.attachments.filter(ref => Tinode.isRelativeURL(ref))
        };
      }
    }

    if (what.length == 0) {
      return Promise.reject(new Error("Invalid {set} parameters"));
    }
    this.#w_send(pkt, pkt.set.id);

    return this.#send(pkt, pkt.set.id);
  }

  /**
   * Range of message IDs to delete.
   *
   * @typedef DelRange
   * @type {Object}
   * @memberof Tinode
   * @property {number} low - low end of the range, inclusive (closed).
   * @property {number=} hi - high end of the range, exclusive (open).
   */
  /**
   * Delete some or all messages in a topic.
   * @memberof Tinode#
   *
   * @param {string} topic - Topic name to delete messages from.
   * @param {Tinode.DelRange[]} list - Ranges of message IDs to delete.
   * @param {boolean=} hard - Hard or soft delete
   *
   * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
   */
  delMessages(topic, ranges, hard) {
    const pkt = this.#initPacket('del', topic);

    pkt.del.what = 'msg';
    pkt.del.delseq = ranges;
    pkt.del.hard = hard;


    this.#w_send(pkt, pkt.del.id);
    return this.#send(pkt, pkt.del.id);
  }

  /**
   * Delete the topic alltogether. Requires Owner permission.
   * @memberof Tinode#
   *
   * @param {string} topicName - Name of the topic to deletegetTopic
   * @param {boolean} hard - hard-delete topic.
   * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
   */
  delTopic(topicName, hard) {
    const pkt = this.#initPacket('del', topicName);
    pkt.del.what = 'topic';
    pkt.del.hard = hard;
    this.#w_send(pkt, pkt.del.id);
    return this.#send(pkt, pkt.del.id);
  }

  /**
   * Delete subscription. Requires Share permission.
   * @memberof Tinode#
   *
   * @param {string} topicName - Name of the topic to delete
   * @param {string} user - User ID to remove.
   * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
   */
  delSubscription(topicName, user) {
    const pkt = this.#initPacket('del', topicName);
    pkt.del.what = 'sub';
    pkt.del.user = user;

    this.#w_send(pkt, pkt.del.id);
    return this.#send(pkt, pkt.del.id);
  }

  /**
   * Delete credential. Always sent on <code>'me'</code> topic.
   * @memberof Tinode#
   *
   * @param {string} method - validation method such as <code>'email'</code> or <code>'tel'</code>.
   * @param {string} value - validation value, i.e. <code>'alice@example.com'</code>.
   * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
   */
  delCredential(method, value) {
    const pkt = this.#initPacket('del', Const.TOPIC_ME);
    pkt.del.what = 'cred';
    pkt.del.cred = {
      meth: method,
      val: value
    };

    this.#w_send(pkt, pkt.del.id);
    return this.#send(pkt, pkt.del.id);
  }

  /**
   * Request to delete account of the current user.
   * @memberof Tinode#
   *
   * @param {boolean} hard - hard-delete user.
   * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
   */
  delCurrentUser(hard) {
    const pkt = this.#initPacket('del', null);
    pkt.del.what = 'user';
    pkt.del.hard = hard;

    this.#w_send(pkt, pkt.del.id);
    return this.#send(pkt, pkt.del.id).then((ctrl) => {
      this._myUID = null;
    });
  }

  /**
   * Notify server that a message or messages were read or received. Does NOT return promise.
   * @memberof Tinode#
   *
   * @param {string} topicName - Name of the topic where the mesage is being aknowledged.
   * @param {string} what - Action being aknowledged, either <code>"read"</code> or <code>"recv"</code>.
   * @param {number} seq - Maximum id of the message being acknowledged.
   */
  note(topicName, what, seq) {
    if (seq <= 0 || seq >= Const.LOCAL_SEQID) {
      throw new Error(`Invalid message id ${seq}`);
    }

    const pkt = this.#initPacket('note', topicName);
    pkt.note.what = what;
    pkt.note.seq = seq;
    this.#w_send(pkt);
    // this.#send(pkt);
  }

  /**
   * Broadcast a key-press notification to topic subscribers. Used to show
   * typing notifications "user X is typing...".
   * @memberof Tinode#
   *
   * @param {string} topicName - Name of the topic to broadcast to.
   */
  noteKeyPress(topicName) {
    const pkt = this.#initPacket('note', topicName);
    pkt.note.what = 'kp';
    this.#w_send(pkt);
  }

  /**
   * Get a named topic, either pull it from cache or create a new instance.
   * There is a single instance of topic for each name.
   * @memberof Tinode#
   *
   * @param {string} topicName - Name of the topic to get.
   * @returns {Tinode.Topic} Requested or newly created topic or <code>undefined</code> if topic name is invalid.
   */
  getTopic(topicName) {
    let topic = this.#cacheGet('topic', topicName);
    if (!topic && topicName) {
      if (topicName == Const.TOPIC_ME) {
        topic = new TopicMe();
      } else if (topicName == Const.TOPIC_FND) {
        topic = new TopicFnd();
      } else {
        topic = new Topic(topicName);
      }
      // Cache management.
      this.#attachCacheToTopic(topic);
      topic._cachePutSelf();
      // Don't save to DB here: a record will be added when the topic is subscribed.
    }
    return topic;
  }

  /**
   * Get a named topic from cache.
   * @memberof Tinode#
   *
   * @param {string} topicName - Name of the topic to get.
   * @returns {Tinode.Topic} Requested topic or <code>undefined</code> if topic is not found in cache.
   */
  cacheGetTopic(topicName) {
    return this.#cacheGet('topic', topicName);
  }

  /**
   * Remove named topic from cache.
   * @memberof Tinode#
   *
   * @param {string} topicName - Name of the topic to remove from cache.
   */
  cacheRemTopic(topicName) {
    this.#cacheDel('topic', topicName);
  }

  /**
   * Iterate over cached topics.
   * @memberof Tinode#
   *
   * @param {Function} func - callback to call for each topic.
   * @param {Object} context - 'this' inside the 'func'.
   */
  mapTopics(func, context) {
    this.#cacheMap('topic', func, context);
  }

  /**
   * Check if named topic is already present in cache.
   * @memberof Tinode#
   *
   * @param {string} topicName - Name of the topic to check.
   * @returns {boolean} true if topic is found in cache, false otherwise.
   */
  isTopicCached(topicName) {
    return !!this.#cacheGet('topic', topicName);
  }

  /**
   * Generate unique name like <code>'new123456'</code> suitable for creating a new group topic.
   * @memberof Tinode#
   *
   * @param {boolean} isChan - if the topic is channel-enabled.
   * @returns {string} name which can be used for creating a new group topic.
   */
  newGroupTopicName(isChan) {
    return (isChan ? Const.TOPIC_NEW_CHAN : Const.TOPIC_NEW) + this.getNextUniqueId();
  }

  /**
   * Instantiate <code>'me'</code> topic or get it from cache.
   * @memberof Tinode#
   *
   * @returns {Tinode.TopicMe} Instance of <code>'me'</code> topic.
   */
  getMeTopic() {
    return this.getTopic(Const.TOPIC_ME);
  }

  /**
   * Instantiate <code>'fnd'</code> (find) topic or get it from cache.
   * @memberof Tinode#
   *
   * @returns {Tinode.Topic} Instance of <code>'fnd'</code> topic.
   */
  getFndTopic() {
    return this.getTopic(Const.TOPIC_FND);
  }

  /**
   * Create a new {@link LargeFileHelper} instance
   * @memberof Tinode#
   *
   * @returns {Tinode.LargeFileHelper} instance of a {@link Tinode.LargeFileHelper}.
   */
  getLargeFileHelper() {
    return new LargeFileHelper(this, Const.PROTOCOL_VERSION);
  }

  /**
   * Get the UID of the the current authenticated user.
   * @memberof Tinode#
   * @returns {string} UID of the current user or <code>undefined</code> if the session is not yet authenticated or if there is no session.
   */
  getCurrentUserID() {
    return this._myUID;
  }

  /**
   * Check if the given user ID is equal to the current user's UID.
   * @memberof Tinode#
   * @param {string} uid - UID to check.
   * @returns {boolean} true if the given UID belongs to the current logged in user.
   */
  isMe(uid) {
    return this._myUID === uid;
  }

  /**
   * Get login used for last successful authentication.
   * @memberof Tinode#
   * @returns {string} login last used successfully or <code>undefined</code>.
   */
  getCurrentLogin() {
    return this._login;
  }

  /**
   * Return information about the server: protocol version and build timestamp.
   * @memberof Tinode#
   * @returns {Object} build and version of the server or <code>null</code> if there is no connection or if the first server response has not been received yet.
   */
  getServerInfo() {
    return this._serverInfo;
  }

  /**
   * Report a topic for abuse. Wrapper for {@link Tinode#publish}.
   * @memberof Tinode.Topic#
   *
   * @param {string} action - the only supported action is 'report'.
   * @param {string} target - name of the topic being reported.
   *
   * @returns {Promise} Promise to be resolved/rejected when the server responds to request.
   */
  report(action, target) {
    return this.publish(Const.TOPIC_SYS, Drafty.attachJSON(null, {
      'action': action,
      'target': target
    }));
  }

  /**
   * Return server-provided configuration value (long integer).
   * @memberof Tinode#
   * @param {string} name of the value to return
   * @param {Object} defaultValue to return in case server limit is not set or not found.
   * @returns {number} named value.
   */
  getServerLimit(name, defaultValue) {
    return (this._serverInfo ? this._serverInfo[name] : null) || defaultValue;
  }

  /**
   * Toggle console logging. Logging is off by default.
   * @memberof Tinode#
   * @param {boolean} enabled - Set to <code>true</code> to enable logging to console.
   * @param {boolean} trimLongStrings - Set to <code>true</code> to trim long strings.
   */
  enableLogging(enabled, trimLongStrings) {
    this._loggingEnabled = enabled;
    this._trimLongStrings = enabled && trimLongStrings;
  }

  /**
   * Set UI language to report to the server. Must be called before <code>'hi'</code> is sent, otherwise it will not be used.
   * @memberof Tinode#
   *
   * @param {string} hl - human (UI) language, like <code>"en_US"</code> or <code>"zh-Hans"</code>.
   */
  setHumanLanguage(hl) {
    if (hl) {
      this._humanLanguage = hl;
    }
  }

  /**
   * Check if given topic is online.
   * @memberof Tinode#
   *
   * @param {string} name of the topic to test.
   * @returns {boolean} true if topic is online, false otherwise.
   */
  isTopicOnline(name) {
    const topic = this.#cacheGet('topic', name);
    return topic && topic.online;
  }

  /**
   * Get access mode for the given contact.
   * @memberof Tinode#
   *
   * @param {string} name of the topic to query.
   * @returns {AccessMode} access mode if topic is found, null otherwise.
   */
  getTopicAccessMode(name) {
    const topic = this.#cacheGet('topic', name);
    return topic ? topic.acs : null;
  }

  /**
   * Include message ID into all subsequest messages to server instructin it to send aknowledgemens.
   * Required for promises to function. Default is <code>"on"</code>.
   * @memberof Tinode#
   *
   * @param {boolean} status - Turn aknowledgemens on or off.
   * @deprecated
   */
  wantAkn(status) {
    if (status) {
      this._messageId = Math.floor((Math.random() * 0xFFFFFF) + 0xFFFFFF);
    } else {
      this._messageId = 0;
    }
  }

  // Callbacks:
  /**
   * Callback to report when the websocket is opened. The callback has no parameters.
   * @memberof Tinode#
   * @type {Tinode.onWebsocketOpen}
   */
  onWebsocketOpen = undefined;

  /**
   * @typedef Tinode.ServerParams
   * @memberof Tinode
   * @type {Object}
   * @property {string} ver - Server version
   * @property {string} build - Server build
   * @property {string=} sid - Session ID, long polling connections only.
   */

  /**
   * @callback Tinode.onConnect
   * @param {number} code - Result code
   * @param {string} text - Text epxplaining the completion, i.e "OK" or an error message.
   * @param {Tinode.ServerParams} params - Parameters returned by the server.
   */
  /**
   * Callback to report when connection with Tinode server is established.
   * @memberof Tinode#
   * @type {Tinode.onConnect}
   */
  onConnect = undefined;

  /**
   * Callback to report when connection is lost. The callback has no parameters.
   * @memberof Tinode#
   * @type {Tinode.onDisconnect}
   */
  onDisconnect = undefined;

  /**
   * @callback Tinode.onLogin
   * @param {number} code - NUmeric completion code, same as HTTP status codes.
   * @param {string} text - Explanation of the completion code.
   */
  /**
   * Callback to report login completion.
   * @memberof Tinode#
   * @type {Tinode.onLogin}
   */
  onLogin = undefined;

  /**
   * Callback to receive <code>{ctrl}</code> (control) messages.
   * @memberof Tinode#
   * @type {Tinode.onCtrlMessage}
   */
  onCtrlMessage = undefined;

  /**
   * Callback to recieve <code>{data}</code> (content) messages.
   * @memberof Tinode#
   * @type {Tinode.onDataMessage}
   */
  onDataMessage = undefined;

  /**
   * Callback to receive <code>{pres}</code> (presence) messages.
   * @memberof Tinode#
   * @type {Tinode.onPresMessage}
   */
  onPresMessage = undefined;

  /**
   * Callback to receive all messages as objects.
   * @memberof Tinode#
   * @type {Tinode.onMessage}
   */
  onMessage = undefined;

  /**
   * Callback to receive all messages as unparsed text.
   * @memberof Tinode#
   * @type {Tinode.onRawMessage}
   */
  onRawMessage = undefined;

  /**
   * Callback to receive server responses to network probes. See {@link Tinode#networkProbe}
   * @memberof Tinode#
   * @type {Tinode.onNetworkProbe}
   */
  onNetworkProbe = undefined;

  /**
   * Callback to be notified when exponential backoff is iterating.
   * @memberof Tinode#
   * @type {Tinode.onAutoreconnectIteration}
   */
  onAutoreconnectIteration = undefined;
};

// Exported constants
Tinode.MESSAGE_STATUS_NONE = Const.MESSAGE_STATUS_NONE;
Tinode.MESSAGE_STATUS_QUEUED = Const.MESSAGE_STATUS_QUEUED;
Tinode.MESSAGE_STATUS_SENDING = Const.MESSAGE_STATUS_SENDING;
Tinode.MESSAGE_STATUS_FAILED = Const.MESSAGE_STATUS_FAILED;
Tinode.MESSAGE_STATUS_SENT = Const.MESSAGE_STATUS_SENT;
Tinode.MESSAGE_STATUS_RECEIVED = Const.MESSAGE_STATUS_RECEIVED;
Tinode.MESSAGE_STATUS_READ = Const.MESSAGE_STATUS_READ;
Tinode.MESSAGE_STATUS_TO_ME = Const.MESSAGE_STATUS_TO_ME;
Tinode.MESSAGE_STATUS_DEL_RANGE = Const.MESSAGE_STATUS_DEL_RANGE;

// Unicode [del] symbol.
Tinode.DEL_CHAR = Const.DEL_CHAR;

// Names of keys to server-provided configuration limits.
Tinode.MAX_MESSAGE_SIZE = 'maxMessageSize';
Tinode.MAX_SUBSCRIBER_COUNT = 'maxSubscriberCount';
Tinode.MAX_TAG_COUNT = 'maxTagCount';
Tinode.MAX_FILE_UPLOAD_SIZE = 'maxFileUploadSize';
