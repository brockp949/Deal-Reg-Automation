// Mock DB so tests don't require a real Postgres instance.
jest.mock('../db', () => {
  const query = jest.fn();
  return {
    __esModule: true,
    query,
    default: {
      query,
      end: jest.fn(),
    },
  };
});

import { logError, logParsingError, getErrorById, getErrorsByFile, resolveError } from '../services/errorTrackingService';

const { query } = require('../db') as { query: jest.Mock };

type MockQueryResult = { rows: any[]; rowCount?: number };

describe('ErrorTrackingService', () => {
    const errorLogs = new Map<string, any>();
    let nextId = 1;

    beforeEach(() => {
        errorLogs.clear();
        nextId = 1;

        query.mockImplementation(async (text: string, params: any[] = []): Promise<MockQueryResult> => {
            const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();

            if (normalized.startsWith('insert into error_logs')) {
                const id = `err_${nextId++}`;
                const now = new Date().toISOString();
                const row = {
                    id,
                    error_category: params[0],
                    error_type: params[1],
                    error_severity: params[2],
                    error_message: params[3],
                    error_code: params[4],
                    error_stack: params[5],
                    source_component: params[6],
                    source_file_id: params[7],
                    entity_type: params[8],
                    entity_id: params[9],
                    file_name: params[10],
                    file_type: params[11],
                    line_number: params[12],
                    column_number: params[13],
                    location_context: params[14],
                    error_data: params[15] ? JSON.parse(params[15]) : null,
                    input_data: params[16],
                    expected_format: params[17],
                    user_id: params[18],
                    session_id: params[19],
                    is_resolved: false,
                    resolved_at: null,
                    resolved_by: null,
                    resolution_notes: null,
                    occurred_at: now,
                    created_at: now,
                    updated_at: now,
                };

                errorLogs.set(id, row);
                return { rows: [{ id }], rowCount: 1 };
            }

            if (normalized.startsWith('select * from error_logs where id =')) {
                const id = params[0];
                const row = errorLogs.get(id);
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }

            if (normalized.startsWith('select * from error_logs where source_file_id =')) {
                const sourceFileId = params[0];
                const rows = Array.from(errorLogs.values())
                    .filter((row) => row.source_file_id === sourceFileId)
                    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
                return { rows, rowCount: rows.length };
            }

            if (normalized.startsWith('update error_logs set is_resolved = true')) {
                const [errorId, resolvedBy, resolutionNotes] = params;
                const row = errorLogs.get(errorId);
                if (!row) {
                    return { rows: [], rowCount: 0 };
                }

                const now = new Date().toISOString();
                row.is_resolved = true;
                row.resolved_at = now;
                row.resolved_by = resolvedBy;
                row.resolution_notes = resolutionNotes ?? null;
                row.updated_at = now;

                return { rows: [], rowCount: 1 };
            }

            throw new Error(`Unhandled query in test mock: ${text}`);
        });
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
