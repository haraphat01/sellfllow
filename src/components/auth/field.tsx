import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Field({
  label,
  name,
  errors,
  hint,
  ...props
}: React.ComponentProps<typeof Input> & { label: string; name: string; errors?: string[]; hint?: React.ReactNode }) {
  const id = `f-${name}`;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {hint}
      </div>
      <Input id={id} name={name} aria-invalid={errors?.length ? true : undefined} aria-describedby={errors?.length ? `${id}-err` : undefined} {...props} />
      {errors?.length ? (
        <p id={`${id}-err`} className="text-xs text-destructive">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}
