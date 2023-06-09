/**
 * @file Access control model.
 *
 * @copyright 2015-2022 Tinode LLC.
 */
'use strict';

// NOTE TO DEVELOPERS:
// Localizable strings should be double quoted "строка на другом языке",
// non-localizable strings should be single quoted 'non-localized'.

/**
 * Helper class for handling access mode.
 *
 * @class AccessMode
 * @memberof Tinode
 *
 * @param {AccessMode|Object=} acs - AccessMode to copy or access mode object received from the server.
 */
export default class AccessMode {
  constructor(acs) {
    if (acs) {
      this.given = typeof acs.given == 'number' ? acs.given : AccessMode.decode(acs.given);
      this.want = typeof acs.want == 'number' ? acs.want : AccessMode.decode(acs.want);
      this.mode = acs.mode ? (typeof acs.mode == 'number' ? acs.mode : AccessMode.decode(acs.mode)) :
        (this.given & this.want);
    }
  }

  static #checkFlag(val, side, flag) {
    side = side || 'mode';
    if (['given', 'want', 'mode'].includes(side)) {
      return ((val[side] & flag) != 0);
    }
    throw new Error(`Invalid AccessMode component '${side}'`);
  }
  /**
   * Parse string into an access mode value.
   * @memberof Tinode.AccessMode
   * @static
   *
   * @param {string | Number} mode - either a String representation of the access mode to parse or a set of bits to assign.
   * @returns {number} - Access mode as a numeric value.
   */
  static decode(str) {
    if (!str) {
      return null;
    } else if (typeof str == 'number') {
      return str & AccessMode._BITMASK;
    } else if (str === 'N' || str === 'n') {
      return AccessMode._NONE;
    }

    const bitmask = {
      'J': AccessMode._JOIN,
      'R': AccessMode._READ,
      'W': AccessMode._WRITE,
      'P': AccessMode._PRES,
      'A': AccessMode._APPROVE,
      'S': AccessMode._SHARE,
      'D': AccessMode._DELETE,
      'O': AccessMode._OWNER
    };

    let m0 = AccessMode._NONE;

    for (let i = 0; i < str.length; i++) {
      const bit = bitmask[str.charAt(i).toUpperCase()];
      if (!bit) {
        // Unrecognized bit, skip.
        continue;
      }
      m0 |= bit;
    }
    return m0;
  }
  /**
   * Convert numeric representation of the access mode into a string.
   *
   * @memberof Tinode.AccessMode
   * @static
   *
   * @param {number} val - access mode value to convert to a string.
   * @returns {string} - Access mode as a string.
   */
  static encode(val) {
    if (val === null || val === AccessMode._INVALID) {
      return null;
    } else if (val === AccessMode._NONE) {
      return 'N';
    }

    const bitmask = ['J', 'R', 'W', 'P', 'A', 'S', 'D', 'O'];
    let res = '';
    for (let i = 0; i < bitmask.length; i++) {
      if ((val & (1 << i)) != 0) {
        res = res + bitmask[i];
      }
    }
    return res;
  }
  /**
   * Update numeric representation of access mode with the new value. The value
   * is one of the following:
   *  - a string starting with <code>'+'</code> or <code>'-'</code> then the bits to add or remove, e.g. <code>'+R-W'</code> or <code>'-PS'</code>.
   *  - a new value of access mode
   *
   * @memberof Tinode.AccessMode
   * @static
   *
   * @param {number} val - access mode value to update.
   * @param {string} upd - update to apply to val.
   * @returns {number} - updated access mode.
   */
  static update(val, upd) {
    if (!upd || typeof upd != 'string') {
      return val;
    }

    let action = upd.charAt(0);
    if (action == '+' || action == '-') {
      let val0 = val;
      // Split delta-string like '+ABC-DEF+Z' into an array of parts including + and -.
      const parts = upd.split(/([-+])/);
      // Starting iteration from 1 because String.split() creates an array with the first empty element.
      // Iterating by 2 because we parse pairs +/- then data.
      for (let i = 1; i < parts.length - 1; i += 2) {
        action = parts[i];
        const m0 = AccessMode.decode(parts[i + 1]);
        if (m0 == AccessMode._INVALID) {
          return val;
        }
        if (m0 == null) {
          continue;
        }
        if (action === '+') {
          val0 |= m0;
        } else if (action === '-') {
          val0 &= ~m0;
        }
      }
      val = val0;
    } else {
      // The string is an explicit new value 'ABC' rather than delta.
      const val0 = AccessMode.decode(upd);
      if (val0 != AccessMode._INVALID) {
        val = val0;
      }
    }

    return val;
  }
  /**
   * Bits present in a1 but missing in a2.
   *
   * @static
   * @memberof Tinode
   *
   * @param {number | string} a1 - access mode to subtract from.
   * @param {number | string} a2 - access mode to subtract.
   * @returns {number} access mode with bits present in <code>a1</code> but missing in <code>a2</code>.
   */
  static diff(a1, a2) {
    a1 = AccessMode.decode(a1);
    a2 = AccessMode.decode(a2);

    if (a1 == AccessMode._INVALID || a2 == AccessMode._INVALID) {
      return AccessMode._INVALID;
    }
    return a1 & ~a2;
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Custom formatter
   */
  toString() {
    return '{"mode": "' + AccessMode.encode(this.mode) +
      '", "given": "' + AccessMode.encode(this.given) +
      '", "want": "' + AccessMode.encode(this.want) + '"}';
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Converts numeric values to strings.
   */
  jsonHelper() {
    return {
      mode: AccessMode.encode(this.mode),
      given: AccessMode.encode(this.given),
      want: AccessMode.encode(this.want)
    };
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Assign value to 'mode'.
   * @memberof Tinode.AccessMode
   *
   * @param {string | Number} m - either a string representation of the access mode or a set of bits.
   * @returns {AccessMode} - <code>this</code> AccessMode.
   */
  setMode(m) {
    this.mode = AccessMode.decode(m);
    return this;
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Update <code>mode</code> value.
   * @memberof Tinode.AccessMode
   *
   * @param {string} u - string representation of the changes to apply to access mode.
   * @returns {AccessMode} - <code>this</code> AccessMode.
   */
  updateMode(u) {
    this.mode = AccessMode.update(this.mode, u);
    return this;
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Get <code>mode</code> value as a string.
   * @memberof Tinode.AccessMode
   *
   * @returns {string} - <code>mode</code> value.
   */
  getMode() {
    return AccessMode.encode(this.mode);
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Assign <code>given</code>  value.
   * @memberof Tinode.AccessMode
   *
   * @param {string | Number} g - either a string representation of the access mode or a set of bits.
   * @returns {AccessMode} - <code>this</code> AccessMode.
   */
  setGiven(g) {
    this.given = AccessMode.decode(g);
    return this;
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Update 'given' value.
   * @memberof Tinode.AccessMode
   *
   * @param {string} u - string representation of the changes to apply to access mode.
   * @returns {AccessMode} - <code>this</code> AccessMode.
   */
  updateGiven(u) {
    this.given = AccessMode.update(this.given, u);
    return this;
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Get 'given' value as a string.
   * @memberof Tinode.AccessMode
   *
   * @returns {string} - <b>given</b> value.
   */
  getGiven() {
    return AccessMode.encode(this.given);
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Assign 'want' value.
   * @memberof Tinode.AccessMode
   *
   * @param {string | Number} w - either a string representation of the access mode or a set of bits.
   * @returns {AccessMode} - <code>this</code> AccessMode.
   */
  setWant(w) {
    this.want = AccessMode.decode(w);
    return this;
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Update 'want' value.
   * @memberof Tinode.AccessMode
   *
   * @param {string} u - string representation of the changes to apply to access mode.
   * @returns {AccessMode} - <code>this</code> AccessMode.
   */
  updateWant(u) {
    this.want = AccessMode.update(this.want, u);
    return this;
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Get 'want' value as a string.
   * @memberof Tinode.AccessMode
   *
   * @returns {string} - <b>want</b> value.
   */
  getWant() {
    return AccessMode.encode(this.want);
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Get permissions present in 'want' but missing in 'given'.
   * Inverse of {@link Tinode.AccessMode#getExcessive}
   *
   * @memberof Tinode.AccessMode
   *
   * @returns {string} permissions present in <b>want</b> but missing in <b>given</b>.
   */
  getMissing() {
    return AccessMode.encode(this.want & ~this.given);
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Get permissions present in 'given' but missing in 'want'.
   * Inverse of {@link Tinode.AccessMode#getMissing}
   * @memberof Tinode.AccessMode
   *
   * @returns {string} permissions present in <b>given</b> but missing in <b>want</b>.
   */
  getExcessive() {
    return AccessMode.encode(this.given & ~this.want);
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Update 'want', 'give', and 'mode' values.
   * @memberof Tinode.AccessMode
   *
   * @param {AccessMode} val - new access mode value.
   * @returns {AccessMode} - <code>this</code> AccessMode.
   */
  updateAll(val) {
    if (val) {
      this.updateGiven(val.given);
      this.updateWant(val.want);
      this.mode = this.given & this.want;
    }
    return this;
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Check if Owner (O) flag is set.
   * @memberof Tinode.AccessMode
   * @param {string=} side - which permission to check: given, want, mode; default: mode.
   * @returns {boolean} - <code>true</code> if flag is set.
   */
  isOwner(side) {
    return AccessMode.#checkFlag(this, side, AccessMode._OWNER);
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Check if Presence (P) flag is set.
   * @memberof Tinode.AccessMode
   * @param {string=} side - which permission to check: given, want, mode; default: mode.
   * @returns {boolean} - <code>true</code> if flag is set.
   */
  isPresencer(side) {
    return AccessMode.#checkFlag(this, side, AccessMode._PRES);
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Check if Presence (P) flag is NOT set.
   * @memberof Tinode.AccessMode
   * @param {string=} side - which permission to check: given, want, mode; default: mode.
   * @returns {boolean} - <code>true</code> if flag is set.
   */
  isMuted(side) {
    return !this.isPresencer(side);
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Check if Join (J) flag is set.
   * @memberof Tinode.AccessMode
   * @param {string=} side - which permission to check: given, want, mode; default: mode.
   * @returns {boolean} - <code>true</code> if flag is set.
   */
  isJoiner(side) {
    return AccessMode.#checkFlag(this, side, AccessMode._JOIN);
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Check if Reader (R) flag is set.
   * @memberof Tinode.AccessMode
   * @param {string=} side - which permission to check: given, want, mode; default: mode.
   * @returns {boolean} - <code>true</code> if flag is set.
   */
  isReader(side) {
    return AccessMode.#checkFlag(this, side, AccessMode._READ);
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Check if Writer (W) flag is set.
   * @memberof Tinode.AccessMode
   * @param {string=} side - which permission to check: given, want, mode; default: mode.
   * @returns {boolean} - <code>true</code> if flag is set.
   */
  isWriter(side) {
    return AccessMode.#checkFlag(this, side, AccessMode._WRITE);
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Check if Approver (A) flag is set.
   * @memberof Tinode.AccessMode
   * @param {string=} side - which permission to check: given, want, mode; default: mode.
   * @returns {boolean} - <code>true</code> if flag is set.
   */
  isApprover(side) {
    return AccessMode.#checkFlag(this, side, AccessMode._APPROVE);
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Check if either one of Owner (O) or Approver (A) flags is set.
   * @memberof Tinode.AccessMode
   * @param {string=} side - which permission to check: given, want, mode; default: mode.
   * @returns {boolean} - <code>true</code> if flag is set.
   */
  isAdmin(side) {
    return this.isOwner(side) || this.isApprover(side);
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Check if either one of Owner (O), Approver (A), or Sharer (S) flags is set.
   * @memberof Tinode.AccessMode
   * @param {string=} side - which permission to check: given, want, mode; default: mode.
   * @returns {boolean} - <code>true</code> if flag is set.
   */
  isSharer(side) {
    return this.isAdmin(side) || AccessMode.#checkFlag(this, side, AccessMode._SHARE);
  }
  /**
   * AccessMode is a class representing topic access mode.
   *
   * @memberof Tinode
   * @class AccessMode
   */
  /**
   * Check if Deleter (D) flag is set.
   * @memberof Tinode.AccessMode
   * @param {string=} side - which permission to check: given, want, mode; default: mode.
   * @returns {boolean} - <code>true</code> if flag is set.
   */
  isDeleter(side) {
    return AccessMode.#checkFlag(this, side, AccessMode._DELETE);
  }
}

AccessMode._NONE = 0x00;
AccessMode._JOIN = 0x01;
AccessMode._READ = 0x02;
AccessMode._WRITE = 0x04;
AccessMode._PRES = 0x08;
AccessMode._APPROVE = 0x10;
AccessMode._SHARE = 0x20;
AccessMode._DELETE = 0x40;
AccessMode._OWNER = 0x80;

AccessMode._BITMASK = AccessMode._JOIN | AccessMode._READ | AccessMode._WRITE | AccessMode._PRES |
  AccessMode._APPROVE | AccessMode._SHARE | AccessMode._DELETE | AccessMode._OWNER;
AccessMode._INVALID = 0x100000;
