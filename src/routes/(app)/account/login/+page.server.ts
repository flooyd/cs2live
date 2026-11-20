import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import type { Actions, PageServerLoad } from './$types';
import { getAuth } from '#lib/server/auth.ts';

type Mode = 'signIn' | 'signUp';

const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '');
const secret = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

/** Every failure carries the same fields, so the page can refill the form. */
const failure = (status: number, mode: Mode, error: string, name = '', email = '') =>
	fail(status, { mode, error, name, email });

function message(err: unknown): string {
	if (err instanceof APIError) return err.body?.message ?? err.message;
	console.error('[auth]', err);
	return 'Something went wrong. Try again.';
}

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/account');
	return { enabled: !!getAuth() };
};

export const actions: Actions = {
	signIn: async ({ request }) => {
		const auth = getAuth();
		if (!auth) return failure(404, 'signIn', 'Accounts are not available here.');
		const form = await request.formData();
		const email = text(form.get('email'));
		const password = secret(form.get('password'));
		if (!email || !password) {
			return failure(400, 'signIn', 'Enter your email and password.', '', email);
		}
		try {
			await auth.api.signInEmail({ body: { email, password }, headers: request.headers });
		} catch (err) {
			return failure(400, 'signIn', message(err), '', email);
		}
		redirect(303, '/account');
	},

	signUp: async ({ request }) => {
		const auth = getAuth();
		if (!auth) return failure(404, 'signUp', 'Accounts are not available here.');
		const form = await request.formData();
		const name = text(form.get('name'));
		const email = text(form.get('email'));
		const password = secret(form.get('password'));
		if (!name || !email || !password) {
			return failure(400, 'signUp', 'Fill in every field.', name, email);
		}
		try {
			await auth.api.signUpEmail({ body: { name, email, password }, headers: request.headers });
		} catch (err) {
			return failure(400, 'signUp', message(err), name, email);
		}
		redirect(303, '/account');
	}
};
