const axios = require('axios');
const utils = require('../utils');

// Public KTON pool and its jetton. The institutional PKTON pool is a private
// pool, so it is not listed as a yield pool.
const POOL = 'EQA9HwEZD_tONfVz6lJS0PVKR5viEiEGyj9AuQewGQVnXPg0';
const KTON = 'EQBuIhXNNkWf9AW9miNGNTSO_uFZ23ejfIWrieXge5f733mw';
const NATIVE_TON = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';

const WINDOW_DAYS = 30;
const YEAR = 365 * 24 * 60 * 60;

// Same variable the TVL repo reads in projects/helper/chain/ton.js. Without a
// key toncenter allows about one request per second.
const apiKey = process.env.TONCENTER_API_KEY;
const requestOptions = {
  timeout: 30000,
  maxRedirects: 0,
  headers: apiKey ? { 'X-API-Key': apiKey } : {},
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = () => sleep(apiKey ? 200 : 1100);

// First masterchain block at or after the given unix time.
async function seqnoAt(utime) {
  const { data } = await axios.get('https://toncenter.com/api/v3/blocks', {
    ...requestOptions,
    params: { workchain: -1, start_utime: utime, limit: 1, sort: 'asc' },
  });
  const block = data.blocks?.[0];
  if (!block) throw new Error('No masterchain block found at ' + utime);
  return { seqno: block.seqno, utime: block.gen_utime };
}

// total_balance / supply from get_pool_full_data, optionally at a past block.
// Positions 2 (total_balance) and 17 (supply) are the same in the old and the
// new stack layout. toncenter v2 serves archival get methods through seqno.
async function poolState(seqno) {
  const body = { address: POOL, method: 'get_pool_full_data', stack: [] };
  if (seqno) body.seqno = seqno;
  const { data } = await axios.post(
    'https://toncenter.com/api/v2/runGetMethod',
    body,
    requestOptions
  );
  if (!data.ok || data.result.exit_code !== 0) {
    throw new Error('get_pool_full_data failed: ' + JSON.stringify(data).slice(0, 200));
  }
  const stack = data.result.stack;
  const totalBalance = Number(BigInt(stack[2][1]));
  const supply = Number(BigInt(stack[17][1]));
  if (!(totalBalance > 0) || !(supply > 0)) {
    throw new Error('Unexpected pool state ' + JSON.stringify([stack[2], stack[17]]));
  }
  return { totalBalance, supply, rate: totalBalance / supply };
}

const apy = async () => {
  const now = await poolState();
  await pause();
  const then = await seqnoAt(Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400);
  await pause();
  const past = await poolState(then.seqno);

  const elapsed = Date.now() / 1000 - then.utime;
  const apyBase = (Math.pow(now.rate / past.rate, YEAR / elapsed) - 1) * 100;

  const { coins } = await utils.getData(
    'https://coins.llama.fi/prices/current/coingecko:the-open-network'
  );
  const tonPrice = coins['coingecko:the-open-network'].price;
  const tvlUsd = (now.totalBalance / 1e9) * tonPrice;

  return [
    {
      pool: `${KTON}-ton`.toLowerCase(),
      chain: utils.formatChain('ton'),
      project: 'kton',
      symbol: 'KTON',
      tvlUsd,
      apyBase,
      underlyingTokens: [NATIVE_TON],
      token: KTON,
      pricePerShare: now.rate,
      isIntrinsicSource: true,
    },
  ];
};

module.exports = {
  protocolId: '6139',
  timetravel: false,
  apy,
  url: 'https://app.kton.io',
};
