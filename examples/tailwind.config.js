/**
 * TraceLanes is styled with Tailwind utility classes and ships no CSS of its
 * own, so the content glob has to reach into the package source or every class
 * it uses is purged and the component renders as unstyled text. FieldCanvas
 * needs none of this -- it is SVG with inline attributes.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', '../src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
