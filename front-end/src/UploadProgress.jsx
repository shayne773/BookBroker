// "Uploading photo 1 of 2 · 40%", while photos upload.
const UploadProgress = ({ progress }) =>
  progress && (
    <p className="upload-progress hint" role="status">
      Uploading photo {progress.index} of {progress.count}
      {progress.percent > 0 && ` · ${progress.percent}%`}
      <progress className="upload-progress__bar" max="100" value={progress.percent} aria-hidden="true" />
    </p>
  );

export default UploadProgress;
