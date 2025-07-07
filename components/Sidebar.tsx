import Link from 'next/link';

export default function Sidebar() {
  return (
    <div className='bg-[#0f172a] text-white w-60 p-4 min-h-screen flex flex-col justify-between'>
      <div>
        <h1 className='text-xl font-bold mb-6'>CoveCRM</h1>
        <nav className='space-y-2'>
          <Link href='/dashboard?tab=home' className='block hover:underline'>Home</Link>
          <Link href='/dashboard?tab=leads' className='block hover:underline'>Leads</Link>
          <Link href='/dashboard?tab=workflows' className='block hover:underline'>Workflows</Link>
          <Link href='/drip-campaigns' className='block hover:underline'>Drip Campaigns</Link>
          <Link href='/dashboard?tab=conversations' className='block hover:underline'>Conversations</Link>
          <Link href='/dashboard?tab=team-activity' className='block hover:underline'>Team Activity</Link>
          <Link href='/dashboard?tab=numbers' className='block hover:underline'>Numbers</Link>
          <Link href='/dashboard?tab=settings' className='block hover:underline'>Settings</Link>
        </nav>
      </div>
      <div className='mt-8'>
        <Link href='/api/logout' className='block text-red-500 hover:underline'>Log Out</Link>
      </div>
    </div>
  );
}
