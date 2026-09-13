'use strict';
// 单元测试：共享层统一出站（lib/http.js）的 Cookie 罐空闲回收与 Cookie 头 jar 合并。
const { t } = require('../helpers');
const httpLib = require('../../server/lib/http');

async function run() {
  // ===== 共享层：Cookie 罐空闲回收（lib/http.js） =====
  {
    const { cookieJars, sweepJars, JAR_TTL_MS } = httpLib._test;
    // 直接构造罐内状态（避免发真实请求）
    cookieJars['unit-test.host'] = { jar: { SPC_CDS: 'abc' }, at: Date.now() - JAR_TTL_MS - 1 };
    cookieJars['unit-test.fresh'] = { jar: { a: '1' }, at: Date.now() };
    sweepJars();
    t('cookieJars：过期罐被回收、新鲜罐保留', !cookieJars['unit-test.host'] && !!cookieJars['unit-test.fresh']);
    delete cookieJars['unit-test.fresh'];
    t('cookieJars：可重复巡检不报错', (() => { sweepJars(); sweepJars(); return true; })());
  }

  // ===== 共享层：Cookie 头的 jar 合并（显式优先 / 大小写不敏感 / 真实请求回归） =====
  {
    const { mergeCookieHeader } = httpLib._test;
    t('mergeCookie：jar 为空时原样返回显式 cookie', mergeCookieHeader('A=1', '') === 'A=1');
    t('mergeCookie：无显式 cookie 时用 jar', mergeCookieHeader('', 'A=1') === 'A=1');
    t('mergeCookie：同名以显式为准且不重复', mergeCookieHeader('A=1', 'A=2; B=3') === 'A=1; B=3', mergeCookieHeader('A=1', 'A=2; B=3'));
    t('mergeCookie：jar 补齐显式缺失的键', mergeCookieHeader('SPC_CDS=x', 'vod=1') === 'SPC_CDS=x; vod=1');
    t('mergeCookie：同名比较大小写不敏感', mergeCookieHeader('spc_cds=x', 'SPC_CDS=y; vod=1') === 'spc_cds=x; vod=1', mergeCookieHeader('spc_cds=x', 'SPC_CDS=y; vod=1'));

    // 回归：旧实现判断 reqHeaders['Cookie']（大写）但调用方传小写 'cookie' → 判断恒真 →
    // jar 非空时追加 'Cookie' 键，经 setHeader 语义（大小写不敏感、后写覆盖）把显式 Cookie 整条顶掉。
    const httpMod = require('http');
    const seen = [];
    const srv = httpMod.createServer((req, res) => {
      seen.push(req.headers.cookie || '');
      res.setHeader('Set-Cookie', 'VODSESSION=jarval');
      res.end('{}');
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}/x`;
    try {
      await httpLib.request({ url, useJar: true, headers: { cookie: 'SELLER=keepme' } }); // jar 尚为空
      await httpLib.request({ url, useJar: true, headers: { cookie: 'SELLER=keepme' } }); // jar 已有 VODSESSION
      await httpLib.request({ url, useJar: true, headers: { cookie: 'VODSESSION=mine' } });
      t('http：jar 为空时显式 cookie 原样发出', seen[0] === 'SELLER=keepme', seen[0]);
      t('http：jar 非空后显式 cookie 不被顶掉（回归旧 bug）', seen[1].includes('SELLER=keepme'), seen[1]);
      t('http：jar 中显式未带的键被补齐', seen[1].includes('VODSESSION=jarval'), seen[1]);
      t('http：同名键以显式 cookie 为准', seen[2].includes('VODSESSION=mine') && !seen[2].includes('jarval'), seen[2]);
    } finally {
      srv.close();
      delete httpLib._test.cookieJars['127.0.0.1'];
    }
  }
}

module.exports = { run };
