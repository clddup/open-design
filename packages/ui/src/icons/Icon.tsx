export type IconName = `${string}:${string}`;

export type IconProps = {
  name: IconName;
  size?: number;
};

export function Icon({ name, size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className="ui-icon"
      data-icon={name}
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <use href={`#${name}`} />
    </svg>
  );
}
