const { join } = require('path')
const { URL } = require('url')
const t = require('tap')

const realFs = require('fs')
const fs = require('../../')
// use t.mock so fs sync methods can be overriden per test
const owner = () => t.mock('../../lib/common/owner-sync.js')

t.test('find', async (t) => {
  // if there's no process.getuid, none of the logic will ever run
  // it never gets called, so it doesn't need to do anything, we just need it
  // to exist so we don't exit early
  if (!process.getuid) {
    process.getuid = () => {}
  }

  t.test('can find directory ownership', async (t) => {
    const dir = t.testdir()
    const stat = fs.lstatSync(dir)

    const result = owner().find(dir)
    t.equal(result.uid, stat.uid, 'found the correct uid')
    t.equal(result.gid, stat.gid, 'found the correct gid')
  })

  t.test('supports file: protocol URL objects as path', async (t) => {
    const dir = t.testdir()
    const stat = fs.lstatSync(dir)

    const result = owner().find(new URL(`file:${dir}`))
    t.equal(result.uid, stat.uid, 'found the correct uid')
    t.equal(result.gid, stat.gid, 'found the correct gid')
  })

  t.test('checks parent directory if lstat rejects', async (t) => {
    const dir = t.testdir()
    const stat = fs.lstatSync(dir)

    const result = owner().find(join(dir, 'not-here'))
    t.equal(result.uid, stat.uid, 'found the correct uid')
    t.equal(result.gid, stat.gid, 'found the correct gid')
  })

  t.test('returns an empty object if lstat rejects for all paths', async (t) => {
    const lstatSync = realFs.lstatSync
    t.teardown(() => {
      realFs.lstatSync = lstatSync
    })

    realFs.lstatSync = () => {
      throw new Error('no')
    }

    const result = owner().find(join('some', 'random', 'path'))
    t.same(result, {}, 'returns an empty object')
  })

  t.test('returns an empty object if process.getuid is missing', async (t) => {
    const getuid = process.getuid
    process.getuid = undefined
    t.teardown(() => process.getuid = getuid)

    const dir = t.testdir()
    const result = owner().find(dir)
    t.same(result, {}, 'returns an empty object')
  })
})

t.test('update', async (t) => {
  t.test('updates ownership', async (t) => {
    const dir = t.testdir({
      'test.txt': 'some content',
    })

    // we hijack stat so we can be certain uid/gid are values other than
    // what we're passing. we also hijack chown so we can be certain it gets
    // called since we won't have a real chown on all platforms
    const stat = realFs.statSync
    const chown = realFs.chownSync
    t.teardown(() => {
      realFs.statSync = stat
      realFs.chownSync = chown
    })

    realFs.statSync = () => ({ uid: 2, gid: 2 })
    realFs.chownSync = (path, uid, gid) => {
      t.equal(path, join(dir, 'test.txt'), 'got the right path')
      t.equal(uid, 1, 'chown() got right uid')
      t.equal(gid, 1, 'chown() got right gid')
    }

    t.doesNotThrow(() => owner().update(join(dir, 'test.txt'), 1, 1))
  })

  t.test('does nothing if uid and gid are undefined', async (t) => {
    const stat = realFs.statSync
    const chown = realFs.chownSync
    t.teardown(() => {
      realFs.statSync = stat
      realFs.chownSync = chown
    })

    realFs.statSync = () => t.fail('should not have called stat()')
    realFs.chownSync = () => t.fail('should not have called chown()')

    t.doesNotThrow(() => owner().update(join('some', 'dir'), undefined, undefined))
  })

  t.test('does not chown if uid and gid match current values', async (t) => {
    const uid = 1
    const gid = 1

    const stat = realFs.statSync
    const chown = realFs.chownSync
    t.teardown(() => {
      realFs.statSync = stat
      realFs.chownSync = chown
    })

    realFs.statSync = () => ({ uid, gid })
    realFs.chownSync = () => t.fail('should not have called chown()')

    t.doesNotThrow(() => owner().update(join('some', 'dir'), uid, gid))
  })

  t.test('chowns if only uid differs from current values', async (t) => {
    const dir = t.testdir({
      'test.txt': 'some content',
    })

    const stat = realFs.statSync
    const chown = realFs.chownSync
    t.teardown(() => {
      realFs.statSync = stat
      realFs.chownSync = chown
    })

    realFs.statSync = () => ({ uid: 2, gid: 1 })
    realFs.chownSync = (path, uid, gid) => {
      t.equal(path, join(dir, 'test.txt'), 'got the right path')
      t.equal(uid, 1, 'chown() got right uid')
      t.equal(gid, 1, 'chown() got right gid')
    }

    t.doesNotThrow(() => owner().update(join(dir, 'test.txt'), 1, 1))
  })

  t.test('chowns if only gid differs from current values', async (t) => {
    const dir = t.testdir({
      'test.txt': 'some content',
    })

    const stat = realFs.statSync
    const chown = realFs.chownSync
    t.teardown(() => {
      realFs.statSync = stat
      realFs.chownSync = chown
    })

    // stat returns uid 1, gid 2
    realFs.statSync = () => ({ uid: 1, gid: 2 })
    realFs.chownSync = (path, uid, gid) => {
      t.equal(path, join(dir, 'test.txt'), 'got the right path')
      t.equal(uid, 1, 'chown() got right uid')
      t.equal(gid, 1, 'chown() got right gid')
    }

    // owner().update tries to set uid 1, gid 1
    t.doesNotThrow(() => owner().update(join(dir, 'test.txt'), 1, 1))
  })
})

t.test('validate', async (t) => {
  t.test('keeps object values', async (t) => {
    const opts = {
      uid: 1,
      gid: 1,
    }

    const result = owner().validate(join('some', 'dir'), opts)
    t.equal(result.uid, opts.uid, 'kept the uid')
    t.equal(result.gid, opts.gid, 'kept the gid')
  })

  t.test('copies a number to both values', async (t) => {
    const result = owner().validate(join('some', 'dir'), 1)
    t.equal(result.uid, 1, 'set the uid')
    t.equal(result.gid, 1, 'set the gid')
  })

  t.test('copies a string to both values', async (t) => {
    const result = owner().validate(join('some', 'dir'), 'something')
    t.equal(result.uid, 'something', 'set the uid')
    t.equal(result.gid, 'something', 'set the gid')
  })

  t.test('can inherit values from the path', async (t) => {
    const dir = t.testdir()
    const stat = fs.lstatSync(dir)

    const result = owner().validate(dir, 'inherit')
    t.equal(result.uid, stat.uid, 'found the right uid')
    t.equal(result.gid, stat.gid, 'found the right gid')
  })

  t.test('can inherit just the uid', async (t) => {
    const dir = t.testdir()
    const stat = fs.lstatSync(dir)

    const opts = {
      uid: 'inherit',
      gid: 1,
    }
    const result = owner().validate(dir, opts)
    t.equal(result.uid, stat.uid, 'found the right uid')
    t.equal(result.gid, 1, 'kept the gid')
  })

  t.test('can inherit just the gid', async (t) => {
    const dir = t.testdir()
    const stat = fs.lstatSync(dir)

    const opts = {
      uid: 1,
      gid: 'inherit',
    }
    const result = owner().validate(dir, opts)
    t.equal(result.uid, 1, 'kept the uid')
    t.equal(result.gid, stat.gid, 'found the right gid')
  })
})
