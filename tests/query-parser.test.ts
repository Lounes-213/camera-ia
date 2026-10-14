/**
 * QueryParser tests — multilingual normalisation, filler removal, language
 * detection and dictionary lookup with fuzzy matching.
 */
import { describe, expect, it } from 'vitest';
import {
  QueryParser,
  detectQueryLang,
  normalizeText,
  stripFillers,
  translateToEnglish,
} from '../src/core/search/QueryParser';

describe('normalizeText', () => {
  it('lowercases and strips Latin accents', () => {
    expect(normalizeText('Fusée')).toBe('fusee');
    expect(normalizeText('Café')).toBe('cafe');
  });

  it('normalises Arabic letter variants and removes diacritics', () => {
    expect(normalizeText('أَرنب')).toBe('ارنب');
    expect(normalizeText('قطة')).toBe('قطه');
  });

  it('collapses whitespace and drops punctuation', () => {
    expect(normalizeText('  a   rocket!! ')).toBe('a rocket');
  });
});

describe('detectQueryLang', () => {
  it('detects Arabic script', () => {
    expect(detectQueryLang('اريد صاروخ')).toBe('ar');
  });

  it('detects French', () => {
    expect(detectQueryLang('je veux une voiture')).toBe('fr');
  });

  it('detects Latin Darija', () => {
    expect(detectQueryLang('bghit rocket')).toBe('darija');
  });

  it('falls back to English', () => {
    expect(detectQueryLang('a rocket')).toBe('en');
  });
});

describe('stripFillers', () => {
  it('removes English fillers', () => {
    expect(stripFillers('give me a rocket please', 'en')).toBe('rocket');
  });

  it('removes French fillers', () => {
    expect(stripFillers('je veux une voiture', 'fr')).toBe('voiture');
  });

  it('removes Arabic fillers', () => {
    expect(stripFillers('اريد قطة', 'ar')).toBe('قطه');
  });

  it('removes Darija fillers', () => {
    expect(stripFillers('bghit wahd mashina', 'darija')).toBe('mashina');
  });
});

describe('translateToEnglish', () => {
  it('translates French nouns', () => {
    expect(translateToEnglish('voiture', 'fr').english).toBe('car');
  });

  it('translates Arabic nouns', () => {
    expect(translateToEnglish('صاروخ', 'ar').english).toBe('rocket');
  });

  it('translates Darija transliteration', () => {
    expect(translateToEnglish('bghit', 'darija').english).toBeNull();
    expect(translateToEnglish('mchat', 'darija').english).toBeNull();
  });

  it('fuzzy-matches a typo', () => {
    const result = translateToEnglish('rockt', 'en');
    expect(result.english).toBe('rocket');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('returns null for nonsense', () => {
    expect(translateToEnglish('zzzzqqq', 'en').english).toBeNull();
  });
});

describe('QueryParser.parse', () => {
  const parser = new QueryParser();

  it('parses an English phrase into a concept', () => {
    const parsed = parser.parse('I want a rocket');
    expect(parsed.lang).toBe('en');
    expect(parsed.english).toBe('rocket');
    expect(parsed.providerQuery).toBe('rocket');
    expect(parsed.fromDictionary).toBe(true);
  });

  it('parses a French phrase into the English concept', () => {
    const parsed = parser.parse('je veux une fusée');
    expect(parsed.lang).toBe('fr');
    expect(parsed.english).toBe('rocket');
  });

  it('parses an Arabic phrase into the English concept', () => {
    const parsed = parser.parse('أريد قطة');
    expect(parsed.lang).toBe('ar');
    expect(parsed.english).toBe('cat');
  });

  it('falls back to raw terms when the word is unknown', () => {
    const parsed = parser.parse('quantum flux capacitor');
    expect(parsed.english).toBeNull();
    expect(parsed.providerQuery).toContain('quantum');
    expect(parsed.fromDictionary).toBe(false);
  });

  it('handles an empty query without throwing', () => {
    const parsed = parser.parse('');
    expect(parsed.normalized).toBe('');
    expect(parsed.english).toBeNull();
  });
});
