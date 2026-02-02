// Purpose: Render a simple placeholder panel with a title and description.
// Persists: None.
// Security Risks: None.

type PlaceholderProps = {
  title: string;
  description: string;
};

export default function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <section>
      <h1>{title}</h1>
      <p>{description}</p>
    </section>
  );
}
