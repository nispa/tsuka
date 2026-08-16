import * as fs from 'fs';
import { Tool } from '../registry';
import { resolveSafePath } from './utils';

export const editFileTool: Tool = {
  name: 'edit_file',
  riskLevel: 'RESTRICTED',
  execute: async (args: { path: string; targetContent: string; replacementContent: string }) => {
    const fullPath = resolveSafePath(args.path);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File '${args.path}' does not exist.`);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const occurrences = content.split(args.targetContent).length - 1;
    if (occurrences === 0) {
      throw new Error(
        `Target content not found in '${args.path}'. Ensure it matches exactly.`
      );
    }
    if (occurrences > 1) {
      throw new Error(
        `Found ${occurrences} occurrences in '${args.path}'. Make 'targetContent' block more specific.`
      );
    }

    // Use replacer function to avoid special pattern interpretations ($&, $', $`, $1...)
    const updatedContent = content.replace(args.targetContent, () => args.replacementContent);
    fs.writeFileSync(fullPath, updatedContent, 'utf-8');
    return `File '${args.path}' edited successfully.`;
  }
};
