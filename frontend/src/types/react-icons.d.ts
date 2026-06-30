// react-icons' IconBaseProps doesn't declare `className`/`style`, even though
// every icon renders an <svg> and forwards both through at runtime (its real
// type is React.SVGAttributes<SVGElement>, which DOES include them — but this
// repo has no @types/react installed, so that extends clause resolves to
// nothing and those fields silently drop). Augment it here instead of
// touching every call site.
//
// `export {}` is required: without it this file is parsed as an ambient
// *script*, and `declare module 'react-icons/lib'` would define a brand new
// module that shadows the real one instead of merging into it.
export {};

declare module 'react-icons/lib' {
  interface IconBaseProps {
    className?: string;
    style?: { [key: string]: string | number | undefined };
  }
}
