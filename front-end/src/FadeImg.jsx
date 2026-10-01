import { useLayoutEffect, useRef, useState } from 'react';

// An <img> that stays clear until it has loaded and then fades in, so a cover
// or a photo is never seen half drawn. One the browser already holds is shown
// before the first paint, with no fade.
const FadeImg = ({ src, className, onError, alt = '', ...rest }) => {
  const [shownSrc, setShownSrc] = useState(null);
  const img = useRef(null);

  useLayoutEffect(() => {
    if (img.current?.complete && img.current.naturalWidth > 0) setShownSrc(src);
  }, [src]);

  return (
    <img
      {...rest}
      ref={img}
      src={src}
      alt={alt}
      className={['fade-img', shownSrc === src && 'is-loaded', className].filter(Boolean).join(' ')}
      onLoad={() => setShownSrc(src)}
      onError={(event) => {
        // A broken image shows as the browser draws one, unless the caller replaces it.
        setShownSrc(src);
        onError?.(event);
      }}
    />
  );
};

export default FadeImg;
