export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.md', '.txt']

export function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))
}
