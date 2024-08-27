import prompts from 'prompts'

export function dateToTimestamp(date: Date) {
  return Math.floor(date.getTime() / 1000)
}

export const prompt = async <T>(args: Omit<prompts.PromptObject, 'name'>): Promise<T> =>
  (await prompts({ ...args, name: 'prompt' })).prompt
