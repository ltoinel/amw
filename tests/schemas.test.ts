/**
 * zod request schemas (#129).
 */

import { parseQuery, productQuerySchema, productsQuerySchema, sanitizeText } from '../src/server/Schemas';

describe('productQuerySchema', () => {
  it.each([
    [{ id: 'B084DN3XVN' }, { id: 'B084DN3XVN' }],
    [{ id: ' B084DN3XVN ' }, { id: 'B084DN3XVN' }],
    [{ id: 'B084DN3XVN', keyword: 'arduino' }, { id: 'B084DN3XVN' }],
    [{ id: '', keyword: 'arduino' }, { keyword: 'arduino' }],
    [{ keyword: ' "arduino" <uno>\n' }, { keyword: 'arduino uno' }],
    [{ id: '0123456789' }, { id: '0123456789' }],
  ])('accepts %j', (query, expected) => {
    expect(parseQuery(productQuerySchema, query)).toEqual({ success: true, data: expected });
  });

  it.each([
    [{}, 'Missing required parameter: id or keyword'],
    [{ id: ' ' }, 'Missing required parameter: id or keyword'],
    [{ keyword: '<>' }, 'Missing required parameter: id or keyword'],
    [{ id: ['B084DN3XVN', 'B08N5WRWNW'] }, 'Parameter id must be a string'],
    [{ keyword: ['a', 'b'] }, 'Parameter keyword must be a string'],
    [{ id: 'B084DN3XV' }, 'Parameter id must be an ASIN (10 uppercase letters or digits)'],
    [{ id: 'b084dn3xvn' }, 'Parameter id must be an ASIN (10 uppercase letters or digits)'],
    [{ id: 'B084DN3XVN?' }, 'Parameter id must be an ASIN (10 uppercase letters or digits)'],
    [{ keyword: 'a'.repeat(101) }, 'Keyword too long (max 100 characters)'],
  ])('rejects %j', (query, message) => {
    expect(parseQuery(productQuerySchema, query)).toEqual({ success: false, message });
  });
});

describe('productsQuerySchema', () => {
  it('splits, trims and deduplicates the ASINs in request order', () => {
    expect(parseQuery(productsQuerySchema, { ids: 'B000000002, B000000001,,B000000002' }))
      .toEqual({ success: true, data: ['B000000002', 'B000000001'] });
  });

  it.each([
    [{}, 'Missing required parameter: ids'],
    [{ ids: ' , ' }, 'Missing required parameter: ids'],
    [{ ids: ['B000000001', 'B000000002'] }, 'Parameter ids must be a string'],
    [{ ids: 'B000000001,nope' }, 'Parameter ids must be an ASIN (10 uppercase letters or digits)'],
    [{ ids: Array.from({ length: 11 }, (_, i) => `B0000000${String(i).padStart(2, '0')}`).join(',') }, 'Too many ids (max 10)'],
  ])('rejects %j', (query, message) => {
    expect(parseQuery(productsQuerySchema, query)).toEqual({ success: false, message });
  });
});

describe('sanitizeText', () => {
  it('removes control and HTML-significant characters and trims', () => {
    expect(sanitizeText(' a<b>"c\'\x00\x7f ')).toBe('abc');
  });
});
