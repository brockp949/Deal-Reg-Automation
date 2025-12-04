import { logError, logParsingError, getErrorById, getErrorsByFile, resolveError } from '../services/errorTrackingService';
import pool from '../db';

describe('ErrorTrackingService', () => {
    beforeAll(async () => {
        // Ensure migrations are run before tests
        // In real scenarios, this would be handled by test setup
    });

    afterEach(async () => {
        // Clean up test data
        await pool.query('DELETE FROM error_logs WHERE error_message LIKE \'%TEST_%\'');
    });

    afterAll(async () => {
        await pool.end();
    });

    describe('logError', () => {
        it('should log a basic error', async () => {
            const errorId = await logError({
                errorCategory: 'parsing',
                errorType: 'test_error',
                errorSeverity: 'error',
                errorMessage: 'TEST_Basic error message',
                sourceComponent: 'test_component',
            });

            expect(errorId).toBeDefined();
            expect(typeof errorId).toBe('string');

            // Verify it was stored
            const stored = await getErrorById(errorId);
            expect(stored).toBeDefined();
            expect(stored?.errorMessage).toBe('TEST_Basic error message');
            expect(stored?.errorCategory).toBe('parsing');
            expect(stored?.isResolved).toBe(false);
        });

        it('should log an error with full context', async () => {
            const errorId = await logError({
                errorCategory: 'extraction',
                errorType: 'extraction_failed',
                errorSeverity: 'critical',
                errorMessage: 'TEST_Failed to extract vendor',
                sourceComponent: 'vendor_extractor',
                sourceFileId: '00000000-0000-0000-0000-000000000001',
                entityType: 'vendor',
                fileName: 'test.mbox',
                fileType: 'mbox',
                lineNumber: 42,
                locationContext: 'Email body line 42',
                errorData: {
                    detectedVendor: 'Test Corp',
                    confidence: 0.65,
                },
                inputData: 'Raw email content...',
                expectedFormat: 'Vendor name in format: Company Name',
            });

            expect(errorId).toBeDefined();

            const stored = await getErrorById(errorId);
            expect(stored).toBeDefined();
            expect(stored?.entityType).toBe('vendor');
            expect(stored?.lineNumber).toBe(42);
            expect(stored?.errorData).toMatchObject({
                detectedVendor: 'Test Corp',
                confidence: 0.65,
            });
        });
    });

    describe('logParsingError', () => {
        it('should log a parsing error with correct defaults', async () => {
            const errorId = await logParsingError({
                sourceFileId: '00000000-0000-0000-0000-000000000002',
                fileName: 'test.csv',
                fileType: 'csv',
                errorMessage: 'TEST_Invalid CSV format',
                errorSeverity: 'warning',
                lineNumber: 10,
                locationContext: 'Row 10',
            });

            const stored = await getErrorById(errorId);
            expect(stored).toBeDefined();
            expect(stored?.errorCategory).toBe('parsing');
            expect(stored?.errorType).toBe('parsing_error');
            expect(stored?.sourceComponent).toBe('file_parser');
        });
    });

    describe('getErrorsByFile', () => {
        it('should retrieve all errors for a specific file', async () => {
            const fileId = '00000000-0000-0000-0000-000000000003';

            // Create multiple errors for the same file
            await logError({
                errorCategory: 'parsing',
                errorType: 'test_error_1',
                errorSeverity: 'error',
                errorMessage: 'TEST_Error 1',
                sourceFileId: fileId,
            });

            await logError({
                errorCategory: 'validation',
                errorType: 'test_error_2',
                errorSeverity: 'warning',
                errorMessage: 'TEST_Error 2',
                sourceFileId: fileId,
            });

            const errors = await getErrorsByFile(fileId);
            expect(errors.length).toBeGreaterThanOrEqual(2);
            expect(errors.every(e => e.sourceFileId === fileId)).toBe(true);
        });
    });

    describe('resolveError', () => {
        it('should mark an error as resolved', async () => {
            const errorId = await logError({
                errorCategory: 'processing',
                errorType: 'test_error',
                errorSeverity: 'error',
                errorMessage: 'TEST_Resolvable error',
            });

            await resolveError(errorId, 'test_user', 'Fixed the issue');

            const resolved = await getErrorById(errorId);
            expect(resolved).toBeDefined();
            expect(resolved?.isResolved).toBe(true);
            expect(resolved?.resolvedBy).toBe('test_user');
            expect(resolved?.resolutionNotes).toBe('Fixed the issue');
            expect(resolved?.resolvedAt).toBeDefined();
        });
    });

    describe('error severity and categorization', () => {
        it('should handle different severity levels', async () => {
            const severities: Array<'critical' | 'error' | 'warning' | 'info'> = [
                'critical',
                'error',
                'warning',
                'info',
            ];

            for (const severity of severities) {
                const id = await logError({
                    errorCategory: 'processing',
                    errorType: 'test_severity',
                    errorSeverity: severity,
                    errorMessage: `TEST_${severity} level error`,
                });

                const stored = await getErrorById(id);
                expect(stored?.errorSeverity).toBe(severity);
            }
        });

        it('should handle different error categories', async () => {
            const categories: Array<'parsing' | 'extraction' | 'validation' | 'processing' | 'integration'> = [
                'parsing',
                'extraction',
                'validation',
                'processing',
                'integration',
            ];

            for (const category of categories) {
                const id = await logError({
                    errorCategory: category,
                    errorType: 'test_category',
                    errorSeverity: 'error',
                    errorMessage: `TEST_${category} error`,
                });

                const stored = await getErrorById(id);
                expect(stored?.errorCategory).toBe(category);
            }
        });
    });
});
