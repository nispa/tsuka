import { Tool } from '../registry';

/**
 * Protocol tool for in-session agent role/skill switching.
 */
export const switchSkillTool: Tool = {
  name: 'switch_skill',
  riskLevel: 'SAFE',
  execute: async (args: { skill: string; reason?: string }) => {
    const skill = (args.skill || '').trim().toLowerCase();
    if (!skill) {
      throw new Error("Parameter 'skill' is required to switch roles/skills.");
    }
    const reason = (args.reason || '').trim();
    const reasonMsg = reason ? ` (Reason: ${reason})` : '';
    return `Skill switched successfully to '${skill}'${reasonMsg}. New skills and allowed tools are now active in context.`;
  }
};
