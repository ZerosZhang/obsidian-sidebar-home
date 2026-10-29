/**
 * Edge-TTS 的 Sec-MS-GEC v2 令牌算法。
 *
 * 移植自 edge-tts 7.3.1（src/edge_tts/drm.py）。微软语音服务现在要求
 * `<16 位十六进制>-<64 位十六进制>` 的 v2 令牌，旧版单一 SHA256 值会被 403 拒绝。
 *
 * 实现按 `>>> 0` 做 32 位模运算，乘法的低 32 位用 Math.imul 保证精确，
 * 因此不依赖 BigInt，保持 tsconfig 的 ES6 目标。
 */

export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

const WIN_EPOCH = 11644473600;

const ROUND_CONSTANTS = [
	0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
	0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
	0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
	0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
	0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
	0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
	0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
	0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
];

const INITIAL = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19];

const STATE = [0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2];

const SCHEDULE = [
	0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491, 0xC0DD25A0,
	0xF9E70AB6, 0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564,
];

const ADJUSTMENT = 0xC9DC06A7;
const BLOCK_CONSTANTS = [...ROUND_CONSTANTS.slice(0, 14), ADJUSTMENT, ...ROUND_CONSTANTS.slice(15)];
const SIGMA0_ADJUSTMENT = 0x059C0B80;
const SIGMA1_ADJUSTMENT = 0x000B92C0;

const CS64_COEFFICIENTS: Array<[number, number]> = [
	[0xE82E91B1, 0xB32700D0], [0x44DE24C6, 0x88DFF51D], [0x3BEB65BC, 0x29514038],
	[0xC89C5933, 0xB328CBDF], [0x8D1EC211, 0xD405B4D5], [0x314EF5D5, 0x26E55F3C],
	[0xE92491B1, 0x607801C6], [0xF0A5B9D5, 0x82B2C1FB], [0x06064CF3, 0xFA51A3DA],
	[0xDA79FA60, 0x207CC464], [0xBED20560, 0x3C3C74F3], [0x89F9C9F8, 0xD2D14B61],
	[0x35FA38C6, 0xBB04A2C1], [0xCB49E3C6, 0xC5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xF2F90B1A;
const CS64_ADJUSTMENT1 = 0x0B1A0000;

/** 32 位循环左移 16 位 */
function rol16(value: number): number {
	return ((value >>> 16) | (value << 16)) >>> 0;
}

function rotr(value: number, bits: number): number {
	return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function sigma0(value: number): number {
	return ((value >>> 7) ^ (value << 25) ^ (value >>> 18) ^ (value << 14) ^ (value >>> 3)) >>> 0;
}

function sigma1(value: number): number {
	return ((value >>> 17) ^ (value << 15) ^ (value >>> 19) ^ (value << 13) ^ (value >>> 10)) >>> 0;
}

function expandSchedule(words: number[], firstWord = 16): void {
	for (let index = firstWord; index < 64; index++) {
		const s1 = sigma1(words[index - 2]);
		const s0 = sigma0(words[index - 15]);
		words.push((s1 + words[index - 7] + s0 + words[index - 16]) >>> 0);
	}
}

function sha256Rounds(state: number[], words: number[], firstRound = 0): number[] {
	let [a, b, c, d, e, f, g, h] = state;
	const constants = firstRound === 14 ? BLOCK_CONSTANTS : ROUND_CONSTANTS;
	const aligned = Math.min(64, Math.floor((firstRound + 7) / 8) * 8);

	for (let index = firstRound; index < aligned; index++) {
		const t1 = (h
			+ (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25))
			+ (g ^ (e & (f ^ g)))
			+ constants[index]
			+ words[index]) >>> 0;
		const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22))
			+ ((a & b) | (c & (a | b)))) >>> 0;
		[a, b, c, d, e, f, g, h] = [(t1 + t2) >>> 0, a, b, c, (d + t1) >>> 0, e, f, g];
	}

	for (let index = aligned; index < 64; index += 8) {
		let t1 = (h
			+ (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25))
			+ (g ^ (e & (f ^ g)))
			+ constants[index]
			+ words[index]) >>> 0;
		d = (d + t1) >>> 0;
		h = (t1
			+ (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22))
			+ ((a & b) | (c & (a | b)))) >>> 0;

		t1 = (g
			+ (rotr(d, 6) ^ rotr(d, 11) ^ rotr(d, 25))
			+ (f ^ (d & (e ^ f)))
			+ constants[index + 1]
			+ words[index + 1]) >>> 0;
		c = (c + t1) >>> 0;
		g = (t1
			+ (rotr(h, 2) ^ rotr(h, 13) ^ rotr(h, 22))
			+ ((h & a) | (b & (h | a)))) >>> 0;

		t1 = (f
			+ (rotr(c, 6) ^ rotr(c, 11) ^ rotr(c, 25))
			+ (e ^ (c & (d ^ e)))
			+ constants[index + 2]
			+ words[index + 2]) >>> 0;
		b = (b + t1) >>> 0;
		f = (t1
			+ (rotr(g, 2) ^ rotr(g, 13) ^ rotr(g, 22))
			+ ((g & h) | (a & (g | h)))) >>> 0;

		t1 = (e
			+ (rotr(b, 6) ^ rotr(b, 11) ^ rotr(b, 25))
			+ (d ^ (b & (c ^ d)))
			+ constants[index + 3]
			+ words[index + 3]) >>> 0;
		a = (a + t1) >>> 0;
		e = (t1
			+ (rotr(f, 2) ^ rotr(f, 13) ^ rotr(f, 22))
			+ ((f & g) | (h & (f | g)))) >>> 0;

		t1 = (d
			+ (rotr(a, 6) ^ rotr(a, 11) ^ rotr(a, 25))
			+ (c ^ (a & (b ^ c)))
			+ constants[index + 4]
			+ words[index + 4]) >>> 0;
		h = (h + t1) >>> 0;
		d = (t1
			+ (rotr(e, 2) ^ rotr(e, 13) ^ rotr(e, 22))
			+ ((e & f) | (g & (e | f)))) >>> 0;

		t1 = (c
			+ (rotr(h, 6) ^ rotr(h, 11) ^ rotr(h, 25))
			+ (b ^ (h & (a ^ b)))
			+ constants[index + 5]
			+ words[index + 5]) >>> 0;
		g = (g + t1) >>> 0;
		c = (t1
			+ (rotr(d, 2) ^ rotr(d, 13) ^ rotr(d, 22))
			+ ((d & e) | (f & (d | e)))) >>> 0;

		t1 = (b
			+ (rotr(g, 6) ^ rotr(g, 11) ^ rotr(g, 25))
			+ (a ^ (g & (h ^ a)))
			+ constants[index + 6]
			+ words[index + 6]) >>> 0;
		f = (f + t1) >>> 0;
		b = (t1
			+ (rotr(c, 2) ^ rotr(c, 13) ^ rotr(c, 22))
			+ ((c & d) | (e & (c | d)))) >>> 0;

		t1 = (a
			+ (rotr(f, 6) ^ rotr(f, 11) ^ rotr(f, 25))
			+ (h ^ (f & (g ^ h)))
			+ constants[index + 7]
			+ words[index + 7]) >>> 0;
		e = (e + t1) >>> 0;
		a = (t1
			+ (rotr(b, 2) ^ rotr(b, 13) ^ rotr(b, 22))
			+ ((b & c) | (d & (b | c)))) >>> 0;
	}

	return [a, b, c, d, e, f, g, h];
}

function bytesToIntBE(bytes: Uint8Array): number {
	let value = 0;
	for (const byte of bytes) value = (value * 256 + byte) >>> 0;
	return value;
}

function sha256Init(data: Uint8Array): number[] {
	const words: number[] = new Array(14).fill(0);
	words.push(bytesToIntBE(data.subarray(0, 3)));
	words.push(bytesToIntBE(data.subarray(3, 7)));

	for (let index = 16; index < 30; index++) {
		let value = SCHEDULE[index - 16];
		if (index - 2 >= 14) {
			value += index === 16
				? sigma1(words[index - 2]) ^ SIGMA1_ADJUSTMENT
				: sigma1(words[index - 2]);
		}
		if (index - 7 >= 14) value += words[index - 7];
		if (index - 15 >= 14) {
			value += index === 29
				? sigma0(words[index - 15]) ^ SIGMA0_ADJUSTMENT
				: sigma0(words[index - 15]);
		}
		words.push(value >>> 0);
	}

	words.push((sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14]
		+ ADJUSTMENT - ROUND_CONSTANTS[14]) >>> 0);

	expandSchedule(words, 31);
	const working = sha256Rounds(STATE.slice(), words, 14);
	return INITIAL.map((initial, index) => (initial + working[index]) >>> 0);
}

function sha256Digest(data: Uint8Array): Uint8Array {
	if (data.length < 7) throw new Error('Token salt must contain at least seven bytes');

	const length = 57 + data.length;
	const zeroCount = ((55 - length) % 64 + 64) % 64;
	const tail = new Uint8Array(data.length - 7 + 1 + zeroCount + 8);
	tail.set(data.subarray(7), 0);
	tail[data.length - 7] = 0x80;

	let bitLength = length * 8;
	for (let index = 0; index < 8; index++) {
		tail[tail.length - 1 - index] = bitLength % 256;
		bitLength = Math.floor(bitLength / 256);
	}

	let state = sha256Init(data.subarray(0, 7));
	for (let offset = 0; offset < tail.length; offset += 64) {
		const words: number[] = [];
		for (let index = 0; index < 16; index++) {
			words.push(bytesToIntBE(tail.subarray(offset + index * 4, offset + index * 4 + 4)));
		}
		expandSchedule(words);
		const working = sha256Rounds(state, words);
		state = state.map((value, index) => (value + working[index]) >>> 0);
	}

	const digest = new Uint8Array(32);
	state.forEach((value, index) => {
		digest[index * 4] = (value >>> 24) & 0xFF;
		digest[index * 4 + 1] = (value >>> 16) & 0xFF;
		digest[index * 4 + 2] = (value >>> 8) & 0xFF;
		digest[index * 4 + 3] = value & 0xFF;
	});
	return digest;
}

function wordsLe4Even(data: Uint8Array): number[] {
	const length = Math.ceil((data.length + 1) / 4) * 4;
	const padded = new Uint8Array(length);
	padded.set(data, 1);

	const words: number[] = [];
	for (let index = 0; index < padded.length; index += 4) {
		words.push((padded[index]
			| (padded[index + 1] << 8)
			| (padded[index + 2] << 16)
			| (padded[index + 3] << 24)) >>> 0);
	}
	if (words.length % 2) words.push(0);
	return words;
}

function cs64Digest(data: Uint8Array, digest: Uint8Array): [number, number] {
	const keyA = ((digest[0] | (digest[1] << 8) | (digest[2] << 16) | (digest[3] << 24)) | 1) >>> 0;
	const keyB = ((digest[4] | (digest[5] << 8) | (digest[6] << 16) | (digest[7] << 24)) | 1) >>> 0;

	const factors = [Math.imul(keyA, CS64_FACTOR) >>> 0, Math.imul(keyB, CS64_FACTOR) >>> 0];
	const terms = CS64_COEFFICIENTS.map(([coefficient], index) =>
		Math.imul(coefficient, factors[index % 2]) >>> 0);
	const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset);

	wordsLe4Even(data).forEach((word, index) => {
		let term = Math.imul(word, index % 2 === 0 ? keyA : keyB) >>> 0;
		let offset = Math.imul(rol16(word), index % 2 === 0 ? 0xEF0569FB : 0xC31713DB) >>> 0;
		if (index === 0) {
			term = (term + Math.imul(CS64_ADJUSTMENT0, factors[0])) >>> 0;
			offset = (offset + CS64_ADJUSTMENT1) >>> 0;
		}
		terms.push(term);
		offsets.push(offset);
	});

	let swapAcc = 0;
	let swapLast = 0;
	let state = 0;
	let acc = 0;

	for (let index = 0; index < terms.length; index += 2) {
		const x = terms[index];
		const y = terms[index + 1];

		let t = rol16((offsets[index] + x) >>> 0);
		let q = Math.imul(t, 0x76F50F34) >>> 0;
		swapAcc = (swapAcc + ((Math.imul(rol16(q), 0xC3EFEA97) + q) >>> 0)) >>> 0;

		t = rol16((offsets[index + 1] + y) >>> 0);
		q = Math.imul(t, 0x1881CE3C) >>> 0;
		swapLast = (Math.imul(rol16(q), 0x35BD1EC9) + q) >>> 0;
		swapAcc = (swapAcc + swapLast) >>> 0;

		state = (Math.imul(state, keyA) + x) >>> 0;
		state = Math.imul(rol16(state), 0xCF98B111) >>> 0;
		state = Math.imul(rol16(state), 0x87085B9F) >>> 0;
		state = Math.imul(rol16(state), 0x12CEB96D) >>> 0;
		state = Math.imul(rol16(state), 0x257E1D83) >>> 0;
		acc = (acc + state) >>> 0;

		t = (Math.imul(state, keyB) + y) >>> 0;
		t = Math.imul(rol16(t), 0xA27416F5) >>> 0;
		t = Math.imul(rol16(t), 0xD38396FF) >>> 0;
		state = Math.imul(rol16(Math.imul(rol16(t), 0x7C932B89) >>> 0), 0xBFA49F69) >>> 0;
		acc = (acc + state) >>> 0;
	}

	return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

function hexLE32(value: number): string {
	let result = '';
	for (let index = 0; index < 4; index++) {
		result += ((value >>> (index * 8)) & 0xFF).toString(16).padStart(2, '0');
	}
	return result.toUpperCase();
}

function bytesToHex(bytes: Uint8Array): string {
	let result = '';
	for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
	return result.toUpperCase();
}

function tokenHash(data: Uint8Array): [string, string] {
	const digest = sha256Digest(data);
	const [low, high] = cs64Digest(data, digest);
	return [hexLE32(low) + hexLE32(high), bytesToHex(digest)];
}

/**
 * 生成 Sec-MS-GEC v2 令牌。
 * @param unixTimestamp 仅用于测试，缺省取当前时间（秒）
 */
export function generateSecMsGec(unixTimestamp?: number): string {
	let ticks = unixTimestamp ?? (Date.now() / 1000);
	ticks += WIN_EPOCH;
	ticks -= ticks % 300;
	ticks *= 10000000;

	const data = new Uint8Array(Buffer.from(`${Math.round(ticks)}${TRUSTED_CLIENT_TOKEN}`, 'ascii'));
	const [cs64, sha256] = tokenHash(data);
	return `${cs64}-${sha256}`;
}
