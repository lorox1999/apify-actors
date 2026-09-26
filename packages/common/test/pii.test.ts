import { describe, expect, it } from 'vitest';

import { scrubText } from '../src/pii.js';

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
