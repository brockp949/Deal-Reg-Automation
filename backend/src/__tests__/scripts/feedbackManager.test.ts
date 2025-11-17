import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import logger from '../../utils/logger';
import { main as feedbackMain } from '../../scripts/feedbackManager';

jest.mock('../../config', () => ({
  config: {
    upload: {
      directory: '',
    },
  },
}));

const logSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);

describe('feedbackManager CLI', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-manager-'));
    const configModule = require('../../config');
    configModule.config.upload.directory = tempDir;
    logSpy.mockClear();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('imports annotations and writes file', async () => {
    const importPath = path.join(tempDir, 'new-annotations.json');
    await fs.writeFile(
      importPath,
      JSON.stringify([{ opportunity_id: 'opp-1', stage: 'quote', priority: 'high' }], null, 2),
      'utf-8'
    );

    await feedbackMain({
      importFile: importPath,
      reviewer: 'QA Tester',
    });

    const saved = JSON.parse(
      await fs.readFile(
        path.join(tempDir, 'opportunities', 'feedback', 'annotations.json'),
        'utf-8'
      )
    );
    expect(saved.annotations).toHaveLength(1);
    expect(saved.annotations[0].reviewer).toBe('QA Tester');
    expect(logSpy).toHaveBeenCalledWith(
      'Feedback import complete',
      expect.objectContaining({ added: 1 })
    );
  });
});
