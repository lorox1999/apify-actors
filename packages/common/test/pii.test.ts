import { describe, expect, it } from 'vitest';

import { redactAnchorText, redactHttpUrl, redactLooseText, redactQueryValue, scrubText } from '../src/pii.js';

describe('scrubText', () => {
    it('removes an email address', () => {
        expect(scrubText('contact john@example.com please', 200)).toBe('contact [removed] please');
    });

    it('removes an E.164-style phone number', () => {
        expect(scrubText('call +1 415 555 0100 today', 200)).not.toContain('415');
        expect(scrubText('call +1 415 555 0100 today', 200)).toContain('[removed]');
    });

    it('removes an @handle', () => {
        expect(scrubText('hello @johndoe there', 200)).toBe('hello [removed] there');
    });

    it('does not treat "C# @ 2x" as a handle', () => {
        expect(scrubText('C# @ 2x', 200)).toBe('C# @ 2x');
    });

    it('does not scrub a bare @ that is not a handle or email', () => {
        expect(scrubText('price @ 10 dollars', 200)).toBe('price @ 10 dollars');
        expect(scrubText('see @', 200)).toBe('see @');
    });

    it('truncates after scrubbing', () => {
        expect(scrubText('abcdefghij', 4)).toBe('abcd');
    });
});

describe('anchor and URL redaction', () => {
    it('redacts anchor emails and phones and caps length at 100 plus an ellipsis', () => {
        expect(redactAnchorText('Email  jane.doe@example.com')).toBe('Email [redacted]');
        expect(redactAnchorText('call +1-555-0100 now')).toBe('call [redacted] now');
        expect(redactAnchorText('x'.repeat(300)).length).toBe(101);
        expect(redactAnchorText('x'.repeat(300)).endsWith('…')).toBe(true);
    });

    it('drops userinfo and redacts email or phone query values', () => {
        const url = redactHttpUrl('http://user:secret@Site.TEST/a?email=jane.doe@example.com&n=1#frag');
        expect(url).toBe('http://site.test/a?email=[redacted-email]&n=1');
        expect(url).not.toContain('secret');
        expect(url).not.toContain('jane.doe');
        expect(redactQueryValue('5550100999')).toBe('[redacted-phone]');
        expect(redactLooseText('http://user:secret@site.test/x jane.doe@example.com')).not.toContain('secret');
        expect(redactLooseText('http://user:secret@site.test/x jane.doe@example.com')).not.toContain('jane.doe');
    });
});
