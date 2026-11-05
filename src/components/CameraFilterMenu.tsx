import { CAMERA_FILTERS, isBlurFilter, isCameraFilter, type CameraFilter } from '../game/cameraFilter';
import { MediaMenu, type MediaMenuSection } from './MediaMenu';

export interface CameraFilterMenuProps {
  filter: CameraFilter;
  /** This browser can blur; otherwise both blurs stay visible but disabled. */
  blurAvailable: boolean;
  /** Same as the camera button next to it: no LiveKit, or "No molestar". */
  disabled: boolean;
  disabledTitle?: string;
  onChange: (filter: CameraFilter) => void;
  /** The camera picker (#284), above the filters; absent, the menu only filters. */
  cameras?: MediaMenuSection;
}

const FILTER_LABEL: Record<CameraFilter, string> = {
  none: 'Sin filtro',
  'blur-light': 'Desenfoque ligero',
  'blur-strong': 'Desenfoque total',
};

const BLUR_UNAVAILABLE_TITLE = 'Este navegador no puede desenfocar el fondo';

/** Caret next to the camera button: which camera, and its filter. */
export function CameraFilterMenu({ filter, blurAvailable, disabled, disabledTitle, onChange, cameras }: CameraFilterMenuProps) {
  const filters: MediaMenuSection = {
    label: 'Filtro de cámara',
    options: CAMERA_FILTERS.map((option) => {
      const unavailable = isBlurFilter(option) && !blurAvailable;
      return {
        value: option,
        label: FILTER_LABEL[option],
        disabled: unavailable,
        title: unavailable ? BLUR_UNAVAILABLE_TITLE : undefined,
      };
    }),
    selected: filter,
    onSelect: (value) => {
      if (isCameraFilter(value)) onChange(value);
    },
  };
  return (
    <MediaMenu
      label="Opciones de cámara"
      sections={cameras ? [cameras, filters] : [filters]}
      disabled={disabled}
      disabledTitle={disabledTitle}
    />
  );
}
