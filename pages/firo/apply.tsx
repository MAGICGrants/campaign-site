import { useRouter } from 'next/router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import Link from 'next/link'

import { Button } from '../../components/ui/button'
import { trpc } from '../../utils/trpc'
import { useFundSlug } from '../../utils/use-fund-slug'
import { useToast } from '../../components/ui/use-toast'
import { fundSlugToRecipientEmail } from '../../utils/funds'

export default function Apply() {
  const fundSlug = useFundSlug()
  const router = useRouter()
  const { toast } = useToast()
  const applyMutation = trpc.application.submitApplication.useMutation()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm()

  async function onSubmit(data: Record<string, string>) {
    if (!fundSlug) return
    await applyMutation.mutateAsync({ fundSlug, formData: data })
    toast({ title: 'Success', description: 'Application successfully submitted!' })
    router.push(`/${fundSlug}/`)
  }

  if (!fundSlug) return <></>

  return (
    <div className="mx-auto flex-1 flex flex-col items-center justify-center gap-4 py-8 prose">
      <form onSubmit={handleSubmit(onSubmit)} className="max-w-5xl flex flex-col gap-4 p-4">
        <div>
          <h1>Application for Firo Fund Project Listing or General Fund Grant</h1>
          <p>Thanks for your interest in the Firo Fund!</p>
          <p>
            We&#39;re incredibly grateful to contributors like you working to support Firo and other
            free and open source projects.
          </p>
          <p>
            Please fill in your contact information and your project idea below so that we can process
            your inquiry.
          </p>
        </div>

        <label className="checkbox">
          <input type="checkbox" {...register('general_fund')} />
          Apply to receive a grant from the MAGIC Firo Fund.
        </label>

        <label className="checkbox">
          <input type="checkbox" {...register('explore_page')} />
          Apply for project to be listed on the MAGIC Firo Fund donation page.
        </label>

        <div className="w-full flex flex-col">
          <label htmlFor="project_name">Project Name *</label>
          <input
            className="appearance-none block w-full text-gray-700 border rounded py-2 px-3 mb-3 leading-tight focus:outline-none focus:ring-0"
            id="project_name"
            type="text"
            {...register('project_name', { required: true })}
          />
        </div>

        <div className="w-full flex flex-col">
          <label htmlFor="your_name">Your Name or Pseudonym *</label>
          <input
            className="appearance-none block w-full text-gray-700 border rounded py-2 px-3 mb-3 leading-tight focus:outline-none focus:ring-0"
            id="your_name"
            type="text"
            {...register('your_name', { required: true })}
          />
        </div>

        <div className="w-full flex flex-col">
          <label htmlFor="email">Email *</label>
          <input
            className="appearance-none block w-full text-gray-700 border rounded py-2 px-3 mb-3 leading-tight focus:outline-none focus:ring-0"
            id="email"
            type="text"
            {...register('email', { required: true })}
          />
        </div>

        <div className="w-full flex flex-col">
          <label htmlFor="github">Project GitHub (if applicable)</label>
          <input
            className="appearance-none block w-full text-gray-700 border rounded py-2 px-3 mb-3 leading-tight focus:outline-none focus:ring-0"
            id="github"
            type="text"
            {...register('github')}
          />
        </div>

        <div className="w-full flex flex-col">
          <label htmlFor="personal_github">Personal GitHub (if applicable)</label>
          <input
            className="appearance-none block w-full text-gray-700 border rounded py-2 px-3 mb-3 leading-tight focus:outline-none focus:ring-0"
            id="personal_github"
            type="text"
            {...register('personal_github')}
          />
        </div>

        <div className="w-full flex flex-col">
          <label htmlFor="other_contact">Other Contact Details (if applicable)</label>
          <small>
            Please list any other relevant contact details you are comfortable sharing in case we
            need to reach out with questions. These could include GitHub username, Twitter username,
            LinkedIn, Reddit handle, other social media handles, emails, phone numbers, usernames,
            etc.
          </small>
          <textarea
            className="appearance-none block w-full text-gray-700 border rounded py-2 px-3 mb-3 leading-tight focus:outline-none focus:ring-0"
            id="other_contact"
            {...register('other_contact')}
          />
        </div>

        <div className="w-full flex flex-col">
          <label htmlFor="short_description">Short Project Description *</label>
          <small>
            This will be listed on the explore projects page of the Firo Fund website. 2-3
            sentences.
          </small>
          <textarea
            className="appearance-none block w-full text-gray-700 border rounded py-2 px-3 mb-3 leading-tight focus:outline-none focus:ring-0"
            id="short_description"
            {...register('short_description', { required: true })}
          />
        </div>

        <div className="w-full flex flex-col">
          <label htmlFor="long_description">Long Project Description</label>
          <small>
            This will be listed on your personal project page of the Firo Fund website. It can be
            longer and go into detail about your project.
          </small>
          <textarea
            className="appearance-none block w-full text-gray-700 border rounded py-2 px-3 mb-3 leading-tight focus:outline-none focus:ring-0"
            id="long_description"
            {...register('long_description')}
          />
        </div>

        <label className="checkbox">
          <input type="checkbox" {...register('free_open_source')} />
          Is the project free and open source?
        </label>

        <label className="checkbox">
          <input type="checkbox" {...register('are_you_lead')} />
          Are you the Project Lead / Lead Contributor
        </label>

        <div className="w-full flex flex-col">
          <label htmlFor="other_lead">
            If someone else, please list the project&#39;s Lead Contributor or Maintainer
          </label>
          <input
            className="appearance-none block w-full text-gray-700 border rounded py-2 px-3 mb-3 leading-tight focus:outline-none focus:ring-0"
            id="other_lead"
            type="text"
            {...register('other_lead')}
          />
        </div>

        <div className="w-full flex flex-col">
          <label htmlFor="potential_impact">Potential Impact *</label>
          <small>Why is this project important to the Firo community?</small>
          <textarea
            className="appearance-none block w-full text-gray-700 border rounded py-2 px-3 mb-3 leading-tight focus:outline-none focus:ring-0"
            id="potential_impact"
            {...register('potential_impact', { required: true })}
          />
        </div>

        <div className="w-full flex flex-col">
          <label htmlFor="timelines">Project Timelines and Potential Milestones *</label>
          <textarea
            className="appearance-none block w-full text-gray-700 border rounded py-2 px-3 mb-3 leading-tight focus:outline-none focus:ring-0"
            id="timelines"
            {...register('timelines', { required: true })}
          />
        </div>

        <div className="w-full flex flex-col">
          <label htmlFor="proposed_budget">
            If you&#39;re applying for a grant from the general fund, please submit a proposed
            budget for the requested amount and how it will be used.
          </label>
          <input
            className="appearance-none block w-full text-gray-700 border rounded py-2 px-3 mb-3 leading-tight focus:outline-none focus:ring-0"
            id="proposed_budget"
            type="text"
            {...register('proposed_budget')}
          />
        </div>

        <div className="w-full flex flex-col">
          <label htmlFor="bios">Applicant Bios (Optional)</label>
          <small>List relevant accomplishments.</small>
          <input
            className="appearance-none block w-full text-gray-700 border rounded py-2 px-3 mb-3 leading-tight focus:outline-none focus:ring-0"
            id="bios"
            type="text"
            {...register('bios')}
          />
        </div>

        <small>
          The MAGIC Firo Fund may require each recipient to sign a Grant Agreement before any funds
          are disbursed. This agreement will set milestones and funds will only be released upon
          completion of milestones. In order to comply with US regulations, recipients will need to
          identify themselves to MAGIC Grants, in accordance with US law.
        </small>

        <Button disabled={applyMutation.isPending}>Apply</Button>

        <p>
          After submitting your application, please allow our team up to three weeks to review your
          application. Email us at{' '}
          <a href={`mailto:${fundSlugToRecipientEmail[fundSlug]}`}>
            {fundSlugToRecipientEmail[fundSlug]}
          </a>{' '}
          if you have any questions.
        </p>
      </form>
    </div>
  )
}
