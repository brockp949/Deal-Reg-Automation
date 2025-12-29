
import { isMboxDelimiterLine } from '../../parsers/enhancedMboxMain';

describe('Robust MBOX Splitter', () => {
    describe('isMboxDelimiterLine', () => {
        it('should identify standard MBOX From lines', () => {
            const line = 'From user@example.com Mon Jan 01 12:34:56 2023';
            expect(isMboxDelimiterLine(line, true)).toBe(true);
            expect(isMboxDelimiterLine(line, false)).toBe(true); // Should pass even if prev line strict check fails because date/time is strong
        });

        it('should reject From: headers', () => {
            const line = 'From: user@example.com';
            expect(isMboxDelimiterLine(line, true)).toBe(false);
            expect(isMboxDelimiterLine(line, false)).toBe(false);
        });

        it('should reject lines starting with >From', () => {
            const line = '>From user@example.com Mon Jan 01 12:34:56 2023';
            expect(isMboxDelimiterLine(line, true)).toBe(false);
        });

        it('should handle missing date/time strictness if previous line was empty', () => {
            const line = 'From user@example.com';
            // Weak signal, but if prev line was empty, we accept it as per fallback
            expect(isMboxDelimiterLine(line, true)).toBe(true);
        });

        it('should reject weak lines if previous line was NOT empty (strict check)', () => {
            const line = 'From in the middle of a sentence';
            expect(isMboxDelimiterLine(line, false)).toBe(false);
        });

        it('should handled complex email addresses', () => {
            const line = 'From "John Doe" <john.doe@example.com> Fri Dec 31 23:59:59 2022';
            expect(isMboxDelimiterLine(line, true)).toBe(true);
        });

        it('should handle minimal date parts if year and time present', () => {
            // E.g. simplified format
            const line = 'From foo@bar 2023 12:00:00';
            expect(isMboxDelimiterLine(line, false)).toBe(true);
        });
    });
});
