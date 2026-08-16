export function pluginCommandId(pluginName: string, commandId: string): string {
  return `plugin:${encodeURIComponent(pluginName)}:${encodeURIComponent(commandId)}`;
}
