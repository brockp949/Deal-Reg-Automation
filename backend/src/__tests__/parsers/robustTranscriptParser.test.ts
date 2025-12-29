
import { TranscriptPreprocessor } from '../../parsers/enhancedTranscriptParser';

describe('Robust Transcript Parser', () => {
    describe('TranscriptPreprocessor.parseSpeakerTurns', () => {
        it('should parse standard speaker turns: Name: text', () => {
            const transcript = 'John: Hello\nJane: Hi there';
            const turns = TranscriptPreprocessor.parseSpeakerTurns(transcript);
            expect(turns).toHaveLength(2);
            expect(turns[0].speaker).toBe('John');
            expect(turns[0].utterance).toBe('Hello');
            expect(turns[1].speaker).toBe('Jane');
        });

        it('should parse multi-word speaker names', () => {
            const transcript = 'Sales Rep: How can I help?\nProspective Customer: I need a deal.';
            const turns = TranscriptPreprocessor.parseSpeakerTurns(transcript);
            expect(turns).toHaveLength(2);
            expect(turns[0].speaker).toBe('Sales Rep');
            expect(turns[1].speaker).toBe('Prospective Customer');
        });

        it('should handle names with roles in parentheses', () => {
            const transcript = 'John Doe (Partner): This is a deal.\nJane Smith (End User): We are interested.';
            const turns = TranscriptPreprocessor.parseSpeakerTurns(transcript);
            expect(turns).toHaveLength(2);
            expect(turns[0].speaker).toBe('John Doe (Partner)');
            expect(turns[1].speaker).toBe('Jane Smith (End User)');
        });

        it('should parse turns with square bracket timestamps: [HH:MM:SS] Name:', () => {
            const transcript = '[00:00:10] John: Start\n[00:00:20] Jane: End';
            const turns = TranscriptPreprocessor.parseSpeakerTurns(transcript);
            expect(turns).toHaveLength(2);
            expect(turns[0].timestamp).toBe('00:00:10');
            expect(turns[0].speaker).toBe('John');
            expect(turns[1].timestamp).toBe('00:00:20');
        });

        it('should parse turns with parentheses timestamps: (HH:MM) Name:', () => {
            const transcript = '(12:34) Sales: Price is $100\n(12:35) Buyer: Too high';
            const turns = TranscriptPreprocessor.parseSpeakerTurns(transcript);
            expect(turns).toHaveLength(2);
            expect(turns[0].timestamp).toBe('12:34');
            expect(turns[1].timestamp).toBe('12:35');
        });

        it('should handle multi-line utterances by same speaker', () => {
            const transcript = 'John: Line one\nLine two\nJane: Line three';
            const turns = TranscriptPreprocessor.parseSpeakerTurns(transcript);
            expect(turns).toHaveLength(2);
            expect(turns[0].utterance).toContain('Line one Line two');
            expect(turns[1].speaker).toBe('Jane');
        });

        it('should handle transcripts starting without a speaker label', () => {
            const transcript = 'Initial noise\nJohn: First real line';
            const turns = TranscriptPreprocessor.parseSpeakerTurns(transcript);
            expect(turns).toHaveLength(2);
            expect(turns[0].speaker).toBe('Unknown');
            expect(turns[0].utterance).toBe('Initial noise');
            expect(turns[1].speaker).toBe('John');
        });

        it('should not misidentify sentences with colons as speaker turns if word count is high', () => {
            const transcript = 'John: Please note: we have a major deal coming up.\nJane: Good to know.';
            const turns = TranscriptPreprocessor.parseSpeakerTurns(transcript);
            // "Please note: we have..." has "Please note" which is 2 words, might be identified.
            // But if it's "This is a very long sentence that happens to have a colon: like this", 
            // it should be rejected.
            const longSentence = 'This is a very long sentence that happens to have a colon: like this\nJane: Hi';
            const turnsLong = TranscriptPreprocessor.parseSpeakerTurns(longSentence);
            expect(turnsLong[0].speaker).toBe('Unknown');
        });
    });
});
