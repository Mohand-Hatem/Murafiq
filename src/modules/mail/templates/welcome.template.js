export const welcomeTemplate = ({ name }) => {
  const displayName = name ? ` ${name}` : '';
  return {
    subject: 'Welcome to Murafiq!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <h2 style="color: #111;">Welcome to Murafiq${displayName}!</h2>
        <p>We're thrilled to have you join our personal styling and shopping community.</p>
        <p>Whether you're looking for expert fashion guidance or ready to offer personal styling services, Murafiq connects you with the right companions for in-person shopping sessions.</p>
        <p>If you have any questions, feel free to reply directly to this email.</p>
        <br />
        <p>Best regards,<br />The Murafiq Team</p>
      </div>
    `,
  };
};

export default welcomeTemplate;
