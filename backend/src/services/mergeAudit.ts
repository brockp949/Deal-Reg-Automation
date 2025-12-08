/**
 * Merge Audit Export Service
 * 
 * Exports merge history for auditing purposes
 */

import { query } from '../db';
import { Parser } from 'json2csv';
import logger from '../utils/logger';

export interface MergeAuditFilter {
    startDate?: Date;
    endDate?: Date;
    mergedBy?: string;
    entityType?: string;
}

/**
 * Export merge history to CSV
 */
export async function exportMergeHistory(filter: MergeAuditFilter): Promise<string> {
    try {
        let sql = `
      SELECT 
        mh.id,
        mh.created_at as "mergeDate",
        mh.merged_by as "mergedBy",
        mh.entity_type as "entityType",
        mh.merge_type as "mergeType",
        mh.merge_strategy as "strategy",
        mh.target_entity_id as "targetId",
        array_length(mh.source_entity_ids, 1) as "sourceCount",
        mh.unmerged as "isUnmerged",
        mh.unmerged_at as "unmergedDate",
        mh.unmerge_reason as "unmergeReason"
      FROM merge_history mh
      WHERE 1=1
    `;

        const params: any[] = [];
        let paramIndex = 1;

        if (filter.startDate) {
            sql += ` AND mh.created_at >= $${paramIndex++}`;
            params.push(filter.startDate);
        }

        if (filter.endDate) {
            sql += ` AND mh.created_at <= $${paramIndex++}`;
            params.push(filter.endDate);
        }

        if (filter.mergedBy) {
            sql += ` AND mh.merged_by = $${paramIndex++}`;
            params.push(filter.mergedBy);
        }

        if (filter.entityType) {
            sql += ` AND mh.entity_type = $${paramIndex++}`;
            params.push(filter.entityType);
        }

        sql += ` ORDER BY mh.created_at DESC`;

        const result = await query(sql, params);

        if (result.rows.length === 0) {
            return '';
        }

        const fields = [
            'id', 'mergeDate', 'mergedBy', 'entityType', 'mergeType',
            'strategy', 'targetId', 'sourceCount', 'isUnmerged',
            'unmergedDate', 'unmergeReason'
        ];

        const parser = new Parser({ fields });
        return parser.parse(result.rows);

    } catch (error: any) {
        logger.error('Failed to export merge history', { error: error.message });
        throw error;
    }
}

export default {
    exportMergeHistory
};
