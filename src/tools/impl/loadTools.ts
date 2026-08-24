import { Tool, ToolExecutionContext, loadToolSchema } from '../registry';
import { LOAD_TOOLS_TOOL } from '../../core/toolSet';

/**
 * Meta-tool that activates the role's deferred tools (T14.14).
 *
 * Deferred tools exist and are already authorized by the role, but their schema
 * stays out of the prompt until needed. This tool promotes them: from the next
 * round on they appear in the `tools` array with their full schema, exactly like
 * any other tool.
 */
export const loadToolsTool: Tool = {
  name: LOAD_TOOLS_TOOL,
  riskLevel: 'SAFE',
  execute: async (args: { names?: string[] | string }, context?: ToolExecutionContext) => {
    const raw = args?.names;
    const requested = (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [])
      .map((n) => String(n || '').trim())
      .filter((n) => n.length > 0);

    if (requested.length === 0) {
      throw new Error("Parameter 'names' is required: the list of tool names to activate.");
    }

    const toolSet = context?.toolSet;
    if (!toolSet) {
      throw new Error(
        'No deferred tool set is available in this context: every tool allowed by the role is already active.'
      );
    }

    const { activated, alreadyActive, unknown } = toolSet.activateTools(requested);

    const parts: string[] = [];
    if (activated.length > 0) {
      // Include the contract in the tool result as well as the next request's tools array.
      // This keeps activation actionable for providers that pay little attention to a newly
      // introduced function definition after completing the load_tools call.
      const described = activated.map((name) => {
        const schema = loadToolSchema(name);
        return `- ${name}: ${schema.description}\n  Usage: call ${name} with arguments matching this JSON Schema: ${JSON.stringify(schema.schema)}`;
      });
      parts.push(
        `Activated ${activated.length} tool(s). You can call them in your next response; their full parameter schemas are also included below:\n${described.join('\n')}`
      );
    }
    if (alreadyActive.length > 0) {
      parts.push(`Already active (schema already in context, call them directly): ${alreadyActive.join(', ')}.`);
    }
    if (unknown.length > 0) {
      const available = toolSet.getDeferredTools();
      parts.push(
        `Not available to this role: ${unknown.join(', ')}. ` +
          (available.length > 0
            ? `Loadable tools are: ${available.join(', ')}.`
            : 'There are no further loadable tools.')
      );
    }

    return parts.join('\n\n');
  }
};
